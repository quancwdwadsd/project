from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import Task, User, Role
from schemas import TaskCreate, TaskUpdate, TaskStatusUpdate, TaskResponse
from security import get_current_user, require_roles

router = APIRouter(
    prefix="/tasks",
    tags=["Tasks"]
)

TASK_STATUSES = {"pending", "in_progress", "completed", "cancelled"}
TASK_PRIORITIES = {"low", "medium", "high"}


def get_role_name(db: Session, user: User):
    role = db.query(Role).filter(Role.id == user.role_id).first()
    return role.role_name.lower() if role else ""


def is_overdue(task: Task):
    if task.status in {"completed", "cancelled"} or not task.due_date:
        return False
    deadline = task.due_date
    now = datetime.now(timezone.utc)
    if deadline.tzinfo is None:
        deadline = deadline.replace(tzinfo=timezone.utc)
    return deadline < now


def task_response(task: Task):
    return {
        "id": task.id,
        "title": task.title,
        "description": task.description,
        "assigned_to": task.assigned_to,
        "assigned_by": task.assigned_by,
        "status": task.status,
        "priority": task.priority,
        "due_date": task.due_date,
        "created_at": task.created_at,
        "overdue": is_overdue(task),
    }


def require_task_view_access(db: Session, user: User, task: Task):
    role_name = get_role_name(db, user)
    if role_name in {"admin", "manager"}:
        return
    if role_name == "employee" and task.assigned_to == user.id:
        return
    raise HTTPException(status_code=403, detail="Permission denied")


@router.get("/", response_model=list[TaskResponse])
def get_tasks(
    assigned_to: int | None = None,
    status: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    role_name = get_role_name(db, current_user)
    query = db.query(Task)
    if role_name == "employee":
        query = query.filter(Task.assigned_to == current_user.id)
        if assigned_to is not None and assigned_to != current_user.id:
            raise HTTPException(status_code=403, detail="Permission denied")
    elif role_name not in {"admin", "manager"}:
        raise HTTPException(status_code=403, detail="Permission denied")
    elif assigned_to is not None:
        query = query.filter(Task.assigned_to == assigned_to)
    if status is not None:
        if status not in TASK_STATUSES:
            raise HTTPException(status_code=400, detail="Invalid task status")
        query = query.filter(Task.status == status)
    tasks = query.order_by(Task.id.desc()).all()
    return [task_response(task) for task in tasks]


@router.get("/{task_id}", response_model=TaskResponse)
def get_task(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    require_task_view_access(db, current_user, task)
    return task_response(task)


@router.post("/", response_model=TaskResponse, status_code=201)
def create_task(
    task_data: TaskCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("Admin", "Manager")),
):
    assigned_user = db.query(User).filter(User.id == task_data.assigned_to).first()
    if not assigned_user or not assigned_user.status:
        raise HTTPException(status_code=404, detail="Assigned active user not found")
    if task_data.priority.lower() not in TASK_PRIORITIES:
        raise HTTPException(status_code=400, detail="Invalid task priority")
    task = Task(
        title=task_data.title,
        description=task_data.description,
        assigned_to=task_data.assigned_to,
        assigned_by=current_user.id,
        due_date=task_data.due_date,
        priority=task_data.priority.lower(),
        status="pending",
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return task_response(task)


@router.put("/{task_id}", response_model=TaskResponse)
def update_task(
    task_id: int,
    task_data: TaskUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("Admin", "Manager")),
):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    updates = task_data.model_dump(exclude_unset=True)
    if "assigned_to" in updates and updates["assigned_to"] is not None:
        assigned_user = db.query(User).filter(User.id == updates["assigned_to"]).first()
        if not assigned_user or not assigned_user.status:
            raise HTTPException(status_code=404, detail="Assigned active user not found")
    if "priority" in updates and updates["priority"] is not None:
        updates["priority"] = updates["priority"].lower()
        if updates["priority"] not in TASK_PRIORITIES:
            raise HTTPException(status_code=400, detail="Invalid task priority")
    for field, value in updates.items():
        setattr(task, field, value)
    db.commit()
    db.refresh(task)
    return task_response(task)


@router.patch("/{task_id}/status", response_model=TaskResponse)
def update_task_status(
    task_id: int,
    status_data: TaskStatusUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    require_task_view_access(db, current_user, task)
    if status_data.status not in TASK_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid task status")
    task.status = status_data.status
    db.commit()
    db.refresh(task)
    return task_response(task)


@router.delete("/{task_id}")
def delete_task(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("Admin", "Manager")),
):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    db.delete(task)
    db.commit()
    return {"message": "Task deleted successfully"}
