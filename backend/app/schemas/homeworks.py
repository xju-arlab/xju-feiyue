"""Individual homework wire contracts; every timestamp is UTC on output."""

import unicodedata
from typing import Literal

from pydantic import AwareDatetime, Field, field_validator

from app.schemas._base import CamelModel, UtcDateTime

NamingOrder = Literal["class-id-name", "class-name-id"]


class HomeworkCreateIn(CamelModel):
    course: str = Field(min_length=1, max_length=120)
    experiment_no: int = Field(ge=1, le=99)
    title: str = Field(default="", max_length=120)
    due_at: AwareDatetime
    naming_class: str = Field(min_length=1, max_length=80)
    naming_order: NamingOrder = "class-id-name"

    @field_validator("course", "title", "naming_class", mode="before")
    @classmethod
    def strip_text(cls, value):
        return unicodedata.normalize("NFC", value.strip()) if isinstance(value, str) else value

    @field_validator("naming_class")
    @classmethod
    def filename_component(cls, value: str) -> str:
        if any(c in '/\\:*?"<>|' or ord(c) < 32 or ord(c) == 127 for c in value):
            raise ValueError("班级名称不能包含文件路径或特殊字符")
        return value


class SubmissionOut(CamelModel):
    filename: str
    size: int
    submitted_at: UtcDateTime


class HomeworkOut(CamelModel):
    id: str
    course: str
    experiment_no: int
    title: str
    due_at: UtcDateTime
    naming_class: str
    naming_order: NamingOrder
    expected_filename: str
    submission: SubmissionOut | None
    submitted_count: int
    total_count: int
    created_at: UtcDateTime


class HomeworkListOut(CamelModel):
    items: list[HomeworkOut]
    can_manage: bool


class HomeworkRecordOut(CamelModel):
    sid: str
    name: str
    filename: str | None
    size: int | None
    submitted_at: UtcDateTime | None


class HomeworkRecordsOut(CamelModel):
    homework: HomeworkOut
    records: list[HomeworkRecordOut]
