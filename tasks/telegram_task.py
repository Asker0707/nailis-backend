# """
# Создает RedirectResponse с установкой flash-сообщения об ошибке в cookie.

# Args:
#     url (str): URL для редиректа.
#     message (str): Текст flash-сообщения об ошибке.

# Returns:
#     RedirectResponse: Ответ с редиректом и установленной flash cookie.
# """
# from celery import shared_task
# import asyncio
# from services.telegram_service import send_telegram_message

# @shared_task(name="tasks.telegram_task.send_telegram_message_task")
# def send_telegram_message_task(chat_id: int, text: str):
#     asyncio.get_event_loop().run_until_complete(
#         send_telegram_message(chat_id, text)
#     )
