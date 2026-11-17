from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import Channel, User
from schemas import ChannelCreate, ChannelUpdate, ChannelResponse
from security import get_current_user, require_roles


router = APIRouter(
    prefix="/channels",
    tags=["Channels"]
)


@router.get("/", response_model=list[ChannelResponse])
def get_channels(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    return db.query(Channel).order_by(Channel.id.desc()).all()


@router.get("/{channel_id}", response_model=ChannelResponse)
def get_channel(
    channel_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    channel = db.query(Channel).filter(
        Channel.id == channel_id
    ).first()

    if not channel:
        raise HTTPException(
            status_code=404,
            detail="Channel not found"
        )

    return channel


@router.post("/", response_model=ChannelResponse)
def create_channel(
    channel_data: ChannelCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("Admin", "Manager"))
):
    if channel_data.assigned_to is not None:
        user = db.query(User).filter(
            User.id == channel_data.assigned_to
        ).first()

        if not user:
            raise HTTPException(
                status_code=404,
                detail="Assigned user not found"
            )

    channel = Channel(
        channel_type=channel_data.channel_type,
        channel_name=channel_data.channel_name,
        assigned_to=channel_data.assigned_to
    )

    db.add(channel)
    db.commit()
    db.refresh(channel)

    return channel


@router.put("/{channel_id}", response_model=ChannelResponse)
def update_channel(
    channel_id: int,
    channel_data: ChannelUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("Admin", "Manager"))
):
    channel = db.query(Channel).filter(
        Channel.id == channel_id
    ).first()

    if not channel:
        raise HTTPException(
            status_code=404,
            detail="Channel not found"
        )

    update_data = channel_data.model_dump(exclude_unset=True)

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
        setattr(channel, key, value)

    db.commit()
    db.refresh(channel)

    return channel


@router.delete("/{channel_id}")
def delete_channel(
    channel_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("Admin"))
):
    channel = db.query(Channel).filter(
        Channel.id == channel_id
    ).first()

    if not channel:
        raise HTTPException(
            status_code=404,
            detail="Channel not found"
        )

    db.delete(channel)
    db.commit()

    return {
        "message": "Channel deleted successfully"
    }
