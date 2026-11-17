from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime
from database import Base


class Role(Base):
    __tablename__ = "roles"

    id = Column(Integer, primary_key=True, index=True)
    role_name = Column(String(50), nullable=False, unique=True)
    description = Column(Text)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), nullable=False, unique=True)
    email = Column(String(100), nullable=False, unique=True)
    password_hash = Column(String(255), nullable=False)
    role_id = Column(Integer, nullable=False)
    status = Column(Boolean, default=True)
    created_at = Column(DateTime)
    updated_at = Column(DateTime)
    failed_login_attempts = Column(Integer, default=0)
    locked_until = Column(DateTime)
