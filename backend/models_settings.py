from sqlalchemy import Column, Integer, String, DateTime

from database import Base


class SystemSetting(Base):
    """Mỗi dòng là một mục cấu hình (khóa - giá trị), ví dụ timezone = Asia/Ho_Chi_Minh."""
    __tablename__ = "system_settings"

    id = Column(Integer, primary_key=True, index=True)
    setting_key = Column(String(50), nullable=False, unique=True)
    setting_value = Column(String(100), nullable=False)
    updated_by = Column(Integer)
    updated_at = Column(DateTime)
