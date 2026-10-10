"""
Модуль security (улучшенная версия)

Функции:
- Хеширование и проверка паролей
- Создание и декодирование JWT access и refresh токенов
- Работа с черным списком JWT токенов в Redis
- Логирование и обработка ошибок безопасности
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException, status
from jose import JWTError, jwt
from passlib.context import CryptContext
from redis.exceptions import RedisError

from core.config import settings
from redis_client import redis

logger = logging.getLogger(__name__)

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")



def utc_now() -> datetime:
    """Возвращает текущее UTC-время"""
    return datetime.now(timezone.utc)


def get_password_hash(password: str) -> str:
    """Хешировать пароль с использованием bcrypt"""
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Проверить соответствие открытого пароля хешу"""
    return pwd_context.verify(plain_password, hashed_password)



def create_jwt_token(
    data: dict, expires_delta: timedelta,
    secret_key: str = settings.SECRET_KEY,
    algorithm: str = settings.ALGORITHM
) -> str:
    """
    Универсальная функция для создания JWT токена
    """
    to_encode = data.copy()
    now = utc_now()
    expire = now + expires_delta
    to_encode.update({"exp": expire, "iat": now})
    encoded_jwt = jwt.encode(to_encode, secret_key, algorithm=algorithm)
    return encoded_jwt


def create_access_token(data: dict) -> str:
    """Создает JWT access токен"""
    return create_jwt_token(
        {**data, "token_type": "access"},
        timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )


def create_refresh_token(data: dict) -> str:
    """Создает JWT refresh токен"""
    return create_jwt_token(
        {**data, "token_type": "refresh"},
        timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
    )



async def add_to_blacklist(token: str, raise_on_error: bool = False):
    """Добавить JWT токен в черный список Redis на время жизни токена"""
    try:
        expire_seconds = settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
        claims = jwt.get_unverified_claims(token)
        exp = claims.get("exp")
        if isinstance(exp, (int, float)):
            expire_seconds = max(int(exp - utc_now().timestamp()), 1)
        await redis.setex(f"blacklist:{token}", expire_seconds, "1")
        logger.info("Токен успешно добавлен в черный список")
    except (RedisError, JWTError, TypeError, ValueError) as e:
        logger.error("Ошибка при добавлении токена в черный список: %s", e)
        if raise_on_error:
            raise


async def is_token_blacklisted(token: str) -> bool:
    """Проверить, находится ли токен в черном списке"""
    try:
        exists = await redis.exists(f"blacklist:{token}") == 1
        logger.debug("Проверка токена в черном списке: %s", exists)
        return exists
    except RedisError as e:
        logger.error("Ошибка при проверке токена в черном списке: %s", e)
        # Fail open on Redis outage to avoid locking out all users
        return False


def _login_attempts_key(email: str) -> str:
    return f"login_attempts:{email.lower().strip()}"


async def check_login_rate_limit(email: str) -> None:
    """Блокирует вход при превышении LOGIN_ATTEMPTS_LIMIT."""
    key = _login_attempts_key(email)
    try:
        raw = await redis.get(key)
        attempts = int(raw) if raw is not None else 0
    except (RedisError, TypeError, ValueError) as e:
        logger.error("Не удалось проверить лимит входа: %s", e)
        return

    if attempts >= settings.LOGIN_ATTEMPTS_LIMIT:
        logger.warning("Превышен лимит попыток входа для %s", email)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Слишком много попыток входа. Попробуйте позже.",
        )


async def register_failed_login(email: str) -> None:
    """Увеличивает счётчик неудачных попыток входа."""
    key = _login_attempts_key(email)
    window = getattr(settings, "LOGIN_ATTEMPTS_WINDOW_SECONDS", 900)
    try:
        attempts = await redis.incr(key)
        if attempts == 1:
            await redis.expire(key, window)
    except RedisError as e:
        logger.error("Не удалось обновить счётчик попыток входа: %s", e)


async def clear_failed_logins(email: str) -> None:
    """Сбрасывает счётчик после успешного входа."""
    try:
        await redis.delete(_login_attempts_key(email))
    except RedisError as e:
        logger.error("Не удалось сбросить счётчик попыток входа: %s", e)



async def decode_token(
    token: Optional[str],
    raise_exc: bool = True,
    expected_token_type: Optional[str] = None,
) -> Optional[str]:
    """
    Декодировать JWT токен, проверить черный список
    и вернуть email пользователя
    """
    if not token:
        if raise_exc:
            logger.warning("Отсутствует токен авторизации")
            raise HTTPException(status.HTTP_401_UNAUTHORIZED,
                                detail="Не авторизован")
        return None

    if await is_token_blacklisted(token):
        if raise_exc:
            logger.warning("Токен был отозван и находится в черном списке")
            raise HTTPException(status.HTTP_401_UNAUTHORIZED,
                                detail="Токен отозван")
        return None

    try:
        payload = jwt.decode(token, settings.SECRET_KEY,
                             algorithms=[settings.ALGORITHM])
        email = payload.get("sub")
        token_type = payload.get("token_type")

        if expected_token_type and token_type != expected_token_type:
            if raise_exc:
                logger.warning(
                    "Ожидался токен типа %s, получен %s",
                    expected_token_type,
                    token_type,
                )
                raise HTTPException(
                    status.HTTP_401_UNAUTHORIZED,
                    detail="Неверный тип токена",
                )
            return None

        if not isinstance(email, str):
            if raise_exc:
                logger.warning(
                    "В токене отсутствует корректное поле sub (email)")
                raise HTTPException(status.HTTP_401_UNAUTHORIZED,
                                    detail="Неверный токен")
            return None
        return email
    except JWTError as e:
        logger.warning("Ошибка при декодировании токена: %s", e)
        if raise_exc:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED,
                                detail="Неверный токен") from e
        return None
