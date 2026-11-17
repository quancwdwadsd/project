from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import Interaction, Channel, User
from schemas import InteractionCreate, InteractionResponse
from security import get_current_user, require_roles


router = APIRouter(
    prefix="/interactions",
    tags=["Interactions"]
)


@router.get("/", response_model=list[InteractionResponse])
def get_interactions(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    return db.query(Interaction).order_by(
        Interaction.received_at.desc()
    ).all()


@router.get("/{interaction_id}", response_model=InteractionResponse)
def get_interaction(
    interaction_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    interaction = db.query(Interaction).filter(
        Interaction.id == interaction_id
    ).first()

    if not interaction:
        raise HTTPException(
            status_code=404,
            detail="Interaction not found"
        )

    return interaction


@router.post("/", response_model=InteractionResponse)
def create_interaction(
    interaction_data: InteractionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("Admin", "Manager"))
):
    channel = db.query(Channel).filter(
        Channel.id == interaction_data.channel_id
    ).first()

    if not channel:
        raise HTTPException(
            status_code=404,
            detail="Channel not found"
        )

    interaction = Interaction(
        channel_id=interaction_data.channel_id,
        interaction_type=interaction_data.interaction_type,
        content=interaction_data.content,
        sender_name=interaction_data.sender_name
    )

    db.add(interaction)
    db.commit()
    db.refresh(interaction)

    return interaction


@router.delete("/{interaction_id}")
def delete_interaction(
    interaction_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("Admin", "Manager"))
):
    interaction = db.query(Interaction).filter(
        Interaction.id == interaction_id
    ).first()

    if not interaction:
        raise HTTPException(
            status_code=404,
            detail="Interaction not found"
        )

    db.delete(interaction)
    db.commit()

    return {
        "message": "Interaction deleted successfully"
    }
