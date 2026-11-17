from pydantic import BaseModel, Field, EmailStr


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    email: EmailStr
    password: str = Field(min_length=8)
    role_id: int


class UserRoleUpdate(BaseModel):
    role_id: int


class UserResponse(BaseModel):
    id: int
    username: str
    email: str
    role_id: int
    role_name: str
    status: bool
