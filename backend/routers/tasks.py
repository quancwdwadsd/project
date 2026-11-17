from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import Task, User
from schemas import TaskCreate, TaskUpdate, TaskStatusUpdate, TaskResponse
from security import get_current_user, require_roles


router = APIRouter(
    prefix="/tasks",
    tags=["Tasks"]
)


@router.get("/", response_model=list[TaskResponse])
def get_tasks(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    return db.query(Task).order_by(Task.id.desc()).all()


@router.get("/{task_id}", response_model=TaskResponse)
def get_task(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    task = db.query(Task).filter(Task.id == task_id).first()

    if not task:
        raise HTTPException(
            status_code=404,
            detail="Task not found"
        )

    return task


@router.post("/", response_model=TaskResponse)
def create_task(
    task_data: TaskCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("Admin", "Manager"))
):
    if task_data.assigned_to is not None:
        user = db.query(User).filter(
            User.id == task_data.assigned_to
        ).first()

        if not user:
            raise HTTPException(
                status_code=404,
                detail="Assigned user not found"
            )

    task = Task(
        title=task_data.title,
        description=task_data.description,
        assigned_to=task_data.assigned_to,
        assigned_by=current_user.id,
        due_date=task_data.due_date,
        status="pending"
    )

    db.add(task)
    db.commit()
    db.refresh(task)

    return task


@router.put("/{task_id}", response_model=TaskResponse)
def update_task(
    task_id: int,
    task_data: TaskUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("Admin", "Manager"))
):
    task = db.query(Task).filter(Task.id == task_id).first()

    if not task:
        raise HTTPException(
            status_code=404,
            detail="Task not found"
        )

    update_data = task_data.model_dump(exclude_unset=True)

    if "assigned_to" in update_data and update_data["assigned_to"] is not None:
        user = db.query(User).filter(
            User.id == update_data["assigned_to"]
        ).first()

        if not user:
            raise HTTPException(
                status_code=404,
                detail="Assigned user not found"
            )

    for key, value in update_data.items():
        setattr(task, key, value)

    db.commit()
    db.refresh(task)

    return task


@router.patch("/{task_id}/status", response_model=TaskResponse)
def update_task_status(
    task_id: int,
    status_data: TaskStatusUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    task = db.query(Task).filter(Task.id == task_id).first()

    if not task:
        raise HTTPException(
            status_code=404,
            detail="Task not found"
        )

    allowed_statuses = [
        "pending",
        "in_progress",
        "completed",
        "cancelled"
    ]

    if status_data.status not in allowed_statuses:
        raise HTTPException(
            status_code=400,
            detail="Invalid task status"
        )

    if current_user.role_id not in [1, 2]:
        if task.assigned_to != current_user.id:
            raise HTTPException(
                status_code=403,
                detail="Permission denied"
            )

    task.status = status_data.status

    db.commit()
    db.refresh(task)

    return task


@router.delete("/{task_id}")
def delete_task(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("Admin", "Manager"))
):
    task = db.query(Task).filter(Task.id == task_id).first()

    if not task:
        raise HTTPException(
            status_code=404,
            detail="Task not found"
        )

    db.delete(task)
    db.commit()

    return {
        "message": "Task deleted successfully"
    }
