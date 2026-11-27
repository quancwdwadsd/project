from typing import Optional

from pydantic import BaseModel, Field


class ApprovalMe(BaseModel):
    id: int
    username: str
    email: str
    role: str
    can_use: bool
    can_review: bool


class ApprovalItem(BaseModel):
    id: int
    title: str
    preview: str
    campaign_tag: Optional[str] = None
    status: str
    reject_reason: Optional[str] = None
    author_id: int
    author_name: Optional[str] = None
    approver_id: Optional[int] = None
    approver_name: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    can_submit: bool
    can_review: bool
    publish_status: Optional[str] = None
    publish_results: list[dict] = Field(default_factory=list)


class ApprovalListResponse(BaseModel):
    items: list[ApprovalItem]
    counts: dict[str, int]
    total: int


class ApprovalHistoryEntry(BaseModel):
    event: str
    action: str
    note: Optional[str] = None
    user_id: Optional[int] = None
    username: Optional[str] = None
    created_at: Optional[str] = None


class ApprovalDetail(ApprovalItem):
    content: str
    history: list[ApprovalHistoryEntry]


class RejectRequest(BaseModel):
    reason: str = ""
