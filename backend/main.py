from fastapi import FastAPI, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session
from database import get_db
from routers.users import router as users_router

app = FastAPI(
    title="Social Media Management API",
    version="1.0.0"
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

@app.get("/")
def home():
    return {
        "message": "Social Media Management API is running"
    }