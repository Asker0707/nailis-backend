"""Сервис финального теста по курсу: генерация вопросов и проверка на сервере."""

from __future__ import annotations

import math
import random
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db import models

ASSESSMENT_FAKE_TITLES = [
    "Продвинутый клиентский сервис",
    "Маркетинг мастера и продажи",
    "Финансовое планирование студии",
    "Командная работа в салоне",
    "Личный бренд мастера",
    "Контент для социальных сетей",
    "Работа с возвратами клиентов",
]


def build_assessment_questions(course_id: UUID, lesson_titles: list[str]) -> list[dict]:
    """Полный payload с correct_answer — только для серверной проверки."""
    if not lesson_titles:
        return []

    questions: list[dict] = []

    count_candidates = {
        str(len(lesson_titles)),
        str(max(1, len(lesson_titles) - 1)),
        str(len(lesson_titles) + 1),
        str(len(lesson_titles) + 2),
    }
    count_options = list(count_candidates)
    random.Random(f"{course_id}:count").shuffle(count_options)
    questions.append(
        {
            "id": "q_total_lessons",
            "prompt": "Сколько уроков входит в этот курс?",
            "options": count_options[:4],
            "correct_answer": str(len(lesson_titles)),
        }
    )

    picked_titles: list[str] = []
    title_indexes = [0, len(lesson_titles) // 2, len(lesson_titles) - 1]
    for index in title_indexes:
        title = lesson_titles[index]
        if title not in picked_titles:
            picked_titles.append(title)

    for idx, actual_title in enumerate(picked_titles[:3], start=1):
        fake_pool = [
            title for title in ASSESSMENT_FAKE_TITLES
            if title not in lesson_titles and title != actual_title
        ]
        if len(fake_pool) < 3:
            fake_pool.extend(
                [
                    f"Дополнительный модуль {n}"
                    for n in range(1, 5)
                    if f"Дополнительный модуль {n}" not in lesson_titles
                ]
            )
        distractors = fake_pool[:3]
        options = [actual_title, *distractors]
        random.Random(f"{course_id}:lesson:{idx}").shuffle(options)
        questions.append(
            {
                "id": f"q_lesson_{idx}",
                "prompt": "Какой из этих уроков действительно есть в программе курса?",
                "options": options,
                "correct_answer": actual_title,
            }
        )

    return questions


def public_assessment_questions(questions: list[dict]) -> list[dict]:
    """Версия без правильных ответов — для шаблона/клиента."""
    return [
        {
            "id": item["id"],
            "prompt": item["prompt"],
            "options": item["options"],
        }
        for item in questions
    ]


def pass_score_for(total: int) -> int:
    if total <= 0:
        return 0
    return max(1, math.ceil(total * 0.75))


def score_answers(questions: list[dict], answers: dict[str, str]) -> tuple[int, int, bool]:
    total = len(questions)
    score = sum(
        1
        for question in questions
        if str(answers.get(question["id"], "")).strip() == str(question["correct_answer"])
    )
    return score, total, score >= pass_score_for(total)


async def load_lesson_titles(course_id: UUID, db: AsyncSession) -> list[str]:
    result = await db.execute(
        select(models.Lesson.title)
        .where(models.Lesson.course_id == course_id)
        .order_by(models.Lesson.title.asc())
    )
    return [row[0] for row in result.all()]
