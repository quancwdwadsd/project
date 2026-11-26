from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session
from database import get_db
from routers.users import router as users_router
from routers.auth import router as auth_router
from routers.posts import router as posts_router
from routers.channels import router as channels_router
from routers.schedules import router as schedules_router
from routers.tasks import router as tasks_router
from routers.media import router as media_router
from routers.interactions import router as interactions_router
from routers.metrics import router as metrics_router
from routers.post_media import router as post_media_router
from routers.activity_logs import router as activity_logs_router
from routers.settings import router as settings_router
from routers.approvals import router as approvals_router
from routers.dashboard import router as dashboard_router


app = FastAPI(
    title="Social Media Management API",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
)


@app.get("/")
def home():
    return {
        "message": "Social Media Management API is running"
    }


@app.get("/test-db")
def test_database(db: Session = Depends(get_db)):
    try:
        database_name = db.execute(
            text("SELECT DATABASE()")
        ).scalar()

        tables = db.execute(
            text("SHOW TABLES")
        ).fetchall()

        return {
            "status": "success",
            "message": "Ket noi MySQL thanh cong!",
            "database": database_name,
            "tables": [table[0] for table in tables]
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=str(e)
        )

app.include_router(users_router)
app.include_router(auth_router)
app.include_router(posts_router)
app.include_router(channels_router)
app.include_router(schedules_router)
app.include_router(tasks_router)
app.include_router(media_router)
app.include_router(interactions_router)
app.include_router(metrics_router)
app.include_router(post_media_router)
app.include_router(activity_logs_router)
app.include_router(settings_router)
app.include_router(approvals_router)
app.include_router(dashboard_router)

@app.get("/")
def home():
    return {
        "message": "Social Media Management API is running"
    }
    
