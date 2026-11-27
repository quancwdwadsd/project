import re

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from database import get_db
from models import ActivityLog, Channel, Post, PostStatusHistory, Role, Schedule, User
from schemas_post_status import PostActivityItem, PostStatusDetail, PostStatusItem
from security import get_current_user

router = APIRouter(prefix="/post-status", tags=["Post Status"])
PUBLISH_STATUSES = {"pending", "publishing", "published", "failed", "cancelled"}


def role_name(db: Session, user: User) -> str:
    role = db.query(Role).filter(Role.id == user.role_id).first()
    return role.role_name.lower() if role else ""


def load_item(db: Session, post: Post, user: User) -> dict:
    return load_items(db, [post], user)[0]


def load_items(db: Session, posts: list[Post], user: User) -> list[dict]:
    if not posts:
        return []
    role = role_name(db, user)
    post_ids = [post.id for post in posts]
    schedule_rows = db.query(Schedule, Channel).join(
        Channel, Channel.id == Schedule.channel_id
    ).filter(Schedule.post_id.in_(post_ids)).order_by(Schedule.scheduled_time.asc()).all()
    creators = {person.id: person.full_name or person.username for person in db.query(User).filter(
        User.id.in_({post.created_by for post in posts})
    ).all()}
    by_post = {post_id: [] for post_id in post_ids}
    for schedule, channel in schedule_rows:
        if role in {"admin", "manager"} or (role in {"editor", "employee"} and channel.assigned_to == user.id):
            by_post[schedule.post_id].append({
                "schedule_id": schedule.id,
                "channel_id": channel.id,
                "channel_name": channel.channel_name,
                "channel_type": channel.channel_type,
                "scheduled_time": schedule.scheduled_time,
                "publish_status": schedule.publish_status,
                "platform_post_id": schedule.platform_post_id,
                "published_url": schedule.published_url,
            })
    return [{
        "id": post.id,
        "title": post.title,
        "campaign_tag": post.campaign_tag,
        "approval_status": post.status or "draft",
        "created_by": post.created_by,
        "created_by_name": creators.get(post.created_by),
        "created_at": post.created_at,
        "updated_at": post.updated_at,
        "channels": by_post[post.id],
    } for post in posts]


def visible_posts(db: Session, user: User):
    role = role_name(db, user)
    posts = db.query(Post).filter(Post.deleted_at.is_(None)).order_by(Post.updated_at.desc(), Post.id.desc()).all()
    if role in {"admin", "manager"}:
        return posts
    if role not in {"editor", "employee"}:
        raise HTTPException(status_code=403, detail="Vai trò của bạn không có quyền theo dõi bài đăng")
    assigned_post_ids = {row[0] for row in db.query(Schedule.post_id).join(
        Channel, Channel.id == Schedule.channel_id
    ).filter(Channel.assigned_to == user.id).all()}
    return [post for post in posts if post.created_by == user.id or post.id in assigned_post_ids]


@router.get("/posts", response_model=list[PostStatusItem])
def list_post_status(
    status: str | None = Query(default=None),
    channel_id: int | None = Query(default=None, ge=1),
    q: str | None = Query(default=None, max_length=100),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if status and status not in PUBLISH_STATUSES | {"draft", "pending", "approved", "rejected"}:
        raise HTTPException(status_code=422, detail="Trạng thái lọc không hợp lệ")
    posts = visible_posts(db, user)
    selected_posts = []
    for post in posts:
        if q and q.strip().casefold() not in (post.title or "").casefold():
            continue
        selected_posts.append(post)
    items = load_items(db, selected_posts, user)
    filtered_items = []
    for item in items:
        if channel_id is not None:
            item["channels"] = [c for c in item["channels"] if c["channel_id"] == channel_id]
            if not item["channels"]:
                continue
        if status:
            if status in PUBLISH_STATUSES:
                if not any(c["publish_status"] == status for c in item["channels"]):
                    continue
            elif item["approval_status"] != status:
                continue
        filtered_items.append(item)
    return filtered_items


@router.get("/posts/{post_id}", response_model=PostStatusDetail)
def get_post_status(
    post_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    post = db.query(Post).filter(Post.id == post_id, Post.deleted_at.is_(None)).first()
    if not post or post.id not in {item.id for item in visible_posts(db, user)}:
        raise HTTPException(status_code=404, detail="Không tìm thấy bài đăng")
    item = load_item(db, post, user)
    history_rows = db.query(PostStatusHistory).filter(
        PostStatusHistory.post_id == post.id
    ).order_by(PostStatusHistory.created_at.desc(), PostStatusHistory.id.desc()).limit(100).all()
    actor_ids = {row.changed_by for row in history_rows if row.changed_by is not None}
    actors = {actor.id: actor.full_name or actor.username for actor in db.query(User).filter(User.id.in_(actor_ids)).all()} if actor_ids else {}
    item["content"] = post.content
    item["history"] = [{
        "id": row.id,
        "schedule_id": row.schedule_id,
        "from_status": row.from_status,
        "to_status": row.to_status,
        "changed_by": row.changed_by,
        "username": actors.get(row.changed_by),
        "reason": row.reason,
        "created_at": row.created_at,
    } for row in history_rows if row.schedule_id is None or any(c["schedule_id"] == row.schedule_id for c in item["channels"])]
    return item


@router.get("/activity", response_model=list[PostActivityItem])
def list_post_activity(
    limit: int = Query(default=30, ge=1, le=100),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if role_name(db, user) not in {"admin", "manager", "editor", "employee"}:
        raise HTTPException(status_code=403, detail="Vai trò của bạn không có quyền xem nhật ký")
    manager_access = role_name(db, user) in {"admin", "manager"}
    accessible_post_ids = {post.id for post in visible_posts(db, user)}
    query = db.query(ActivityLog).filter(or_(
        ActivityLog.action.like("%bài #%"),
        ActivityLog.action.like("%nội dung #%"),
        ActivityLog.action.like("Đổi quyền người dùng%") if manager_access else ActivityLog.id == -1,
        ActivityLog.action.like("Thu hồi quyền và xóa người dùng%") if manager_access else ActivityLog.id == -1,
    ))
    rows = query.order_by(ActivityLog.created_at.desc(), ActivityLog.id.desc()).limit(limit).all()
    rows = [row for row in rows if manager_access or (
        (match := re.search(r"(?:bài|nội dung) #(\d+)", row.action, re.IGNORECASE))
        and int(match.group(1)) in accessible_post_ids
    )]
    ids = {row.user_id for row in rows if row.user_id is not None}
    names = {person.id: person.full_name or person.username for person in db.query(User).filter(User.id.in_(ids)).all()} if ids else {}
    return [{"id": row.id, "user_id": row.user_id, "username": names.get(row.user_id), "action": row.action, "created_at": row.created_at} for row in rows]
