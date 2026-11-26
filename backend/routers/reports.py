from datetime import date, datetime, time, timedelta
from io import BytesIO
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, and_
from sqlalchemy.orm import Session

from database import get_db
from models import Channel, Post, PostMetric, Role, Schedule, User
from security import get_current_user

router = APIRouter(prefix="/reports", tags=["Reports"])

MAX_EXPORT_ROWS = 1000


def get_role_name(db: Session, user: User) -> str:
    role = db.query(Role).filter(Role.id == user.role_id).first()
    return role.role_name if role else ""


def is_manager(role_name: str) -> bool:
    return role_name.lower() in {"admin", "manager"}


def latest_metrics_query(db: Session, user: User, role_name: str, date_from=None, date_to=None):
    latest_query = db.query(
        PostMetric.post_id.label("post_id"),
        func.max(PostMetric.id).label("latest_id")
    )
    if date_from:
        latest_query = latest_query.filter(PostMetric.collected_at >= datetime.combine(date_from, time.min))
    if date_to:
        latest_query = latest_query.filter(PostMetric.collected_at < datetime.combine(date_to + timedelta(days=1), time.min))
    latest = latest_query.group_by(PostMetric.post_id).subquery()
    query = (
        db.query(PostMetric, Post)
        .join(latest, and_(
            PostMetric.id == latest.c.latest_id
        ))
        .join(Post, Post.id == PostMetric.post_id)
    )
    if not is_manager(role_name):
        query = query.filter(Post.created_by == user.id)
    return query


def apply_filters(query, date_from, date_to, status, campaign_tag):
    if date_from:
        query = query.filter(PostMetric.collected_at >= datetime.combine(date_from, time.min))
    if date_to:
        query = query.filter(PostMetric.collected_at < datetime.combine(date_to + timedelta(days=1), time.min))
    if status:
        query = query.filter(Post.status == status)
    if campaign_tag:
        query = query.filter(Post.campaign_tag.ilike(f"%{campaign_tag.strip()}%"))
    return query


def serialize_rows(pairs):
    return [{
        "post_id": post.id,
        "title": post.title or "",
        "status": post.status or "",
        "campaign_tag": post.campaign_tag or "",
        "created_at": post.created_at.isoformat() if post.created_at else "",
        "collected_at": metric.collected_at.isoformat() if metric.collected_at else "",
        "likes": metric.likes or 0,
        "comments": metric.comments or 0,
        "shares": metric.shares or 0,
        "views": metric.views or 0,
        "source": metric.source or ""
    } for metric, post in pairs]


def get_report_rows(db, user, role_name, date_from, date_to, status, campaign_tag, limit):
    query = apply_filters(latest_metrics_query(db, user, role_name, date_from, date_to), date_from, date_to, status, campaign_tag)
    total = query.count()
    if total > limit:
        raise HTTPException(
            status_code=413,
            detail=f"Báo cáo có {total} dòng, vượt giới hạn {limit}. Vui lòng thu hẹp bộ lọc."
        )
    pairs = query.order_by(PostMetric.collected_at.desc(), Post.id.desc()).limit(limit + 1).all()
    if len(pairs) > limit:
        raise HTTPException(status_code=413, detail=f"Dữ liệu vượt giới hạn {limit}. Vui lòng thu hẹp bộ lọc.")
    rows = serialize_rows(pairs)
    totals = {
        "posts": len(rows),
        "likes": sum(row["likes"] for row in rows),
        "comments": sum(row["comments"] for row in rows),
        "shares": sum(row["shares"] for row in rows),
        "views": sum(row["views"] for row in rows),
    }
    return rows, totals


def report_params(
    date_from: Optional[date],
    date_to: Optional[date],
    status: Optional[str],
    campaign_tag: Optional[str],
    limit: int
):
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=422, detail="Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.")
    if status and status not in {"draft", "pending", "approved", "rejected", "published"}:
        raise HTTPException(status_code=422, detail="Trạng thái lọc không hợp lệ.")
    return date_from, date_to, status, campaign_tag, limit


def auth_context(db: Session, user: User):
    return get_role_name(db, user)


@router.get("/preview")
def preview_report(
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    status: Optional[str] = Query(default=None),
    campaign_tag: Optional[str] = Query(default=None, max_length=100),
    limit: int = Query(default=MAX_EXPORT_ROWS, ge=1, le=MAX_EXPORT_ROWS),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    date_from, date_to, status, campaign_tag, limit = report_params(date_from, date_to, status, campaign_tag, limit)
    role_name = auth_context(db, current_user)
    query = apply_filters(latest_metrics_query(db, current_user, role_name, date_from, date_to), date_from, date_to, status, campaign_tag)
    count = query.count()
    if count > limit:
        raise HTTPException(status_code=413, detail=f"Báo cáo có {count} dòng, vượt giới hạn {limit}. Vui lòng thu hẹp bộ lọc.")
    pairs = query.order_by(PostMetric.collected_at.desc(), Post.id.desc()).limit(limit + 1).all()
    rows = serialize_rows(pairs)
    channel_map = {}
    post_ids = [row["post_id"] for row in rows]
    if post_ids:
        links = (
            db.query(Schedule.post_id, Channel.channel_type)
            .join(Channel, Channel.id == Schedule.channel_id)
            .filter(Schedule.post_id.in_(post_ids))
            .distinct()
            .all()
        )
        for post_id, channel_type in links:
            channel_map.setdefault(post_id, set()).add((channel_type or "").strip().lower())
    for row in rows:
        row["channels"] = sorted(channel_map.get(row["post_id"], []))
    totals = {
        "posts": len(rows),
        "likes": sum(row["likes"] for row in rows),
        "comments": sum(row["comments"] for row in rows),
        "shares": sum(row["shares"] for row in rows),
        "views": sum(row["views"] for row in rows),
    }
    return {"total": count, "limit": limit, "totals": totals, "rows": rows}


def export_data(date_from, date_to, status, campaign_tag, db, user):
    date_from, date_to, status, campaign_tag, _ = report_params(date_from, date_to, status, campaign_tag, MAX_EXPORT_ROWS)
    role_name = auth_context(db, user)
    return get_report_rows(db, user, role_name, date_from, date_to, status, campaign_tag, MAX_EXPORT_ROWS)


def filename_stamp():
    return datetime.now().strftime("%Y%m%d_%H%M%S")


@router.get("/export/excel")
def export_excel(
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    status: Optional[str] = Query(default=None),
    campaign_tag: Optional[str] = Query(default=None, max_length=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    rows, totals = export_data(date_from, date_to, status, campaign_tag, db, current_user)
    try:
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill, Alignment
        from openpyxl.utils import get_column_letter
    except ImportError:
        raise HTTPException(status_code=500, detail="Thiếu thư viện openpyxl. Vui lòng cài dependencies backend.")

    wb = Workbook()
    summary = wb.active
    summary.title = "Tong quan"
    summary.append(["BÁO CÁO RP-03"])
    summary.append(["Số bài viết", totals["posts"]])
    summary.append(["Lượt thích", totals["likes"]])
    summary.append(["Bình luận", totals["comments"]])
    summary.append(["Chia sẻ", totals["shares"]])
    summary.append(["Lượt xem", totals["views"]])
    summary.append(["Ngày xuất", datetime.now().strftime("%d/%m/%Y %H:%M")])
    for cell in summary[1]:
        cell.font = Font(bold=True, color="FFFFFF", size=14)
        cell.fill = PatternFill("solid", fgColor="24352B")
    summary.column_dimensions["A"].width = 26
    summary.column_dimensions["B"].width = 22

    sheet = wb.create_sheet("Chi tiet")
    headers = ["ID bài viết", "Tiêu đề", "Trạng thái", "Chiến dịch", "Ngày tạo", "Ngày đo", "Lượt thích", "Bình luận", "Chia sẻ", "Lượt xem", "Nguồn"]
    sheet.append(headers)

    def safe_excel_text(value):
        text = str(value or "")
        if text.startswith(("=", "+", "-", "@")):
            return "'" + text
        return text

    for row in rows:
        sheet.append([row["post_id"], safe_excel_text(row["title"]), safe_excel_text(row["status"]), safe_excel_text(row["campaign_tag"]), safe_excel_text(row["created_at"]), safe_excel_text(row["collected_at"]), row["likes"], row["comments"], row["shares"], row["views"], safe_excel_text(row["source"])])
    for cell in sheet[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="24352B")
        cell.alignment = Alignment(horizontal="center", vertical="center")
    sheet.freeze_panes = "A2"
    sheet.auto_filter.ref = sheet.dimensions
    widths = [12, 40, 18, 24, 22, 22, 14, 14, 14, 14, 18]
    for i, width in enumerate(widths, 1):
        sheet.column_dimensions[get_column_letter(i)].width = width

    buffer = BytesIO()
    wb.save(buffer)
    buffer.seek(0)
    filename = f"RP03_bao_cao_{filename_stamp()}.xlsx"
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


@router.get("/export/pdf")
def export_pdf(
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    status: Optional[str] = Query(default=None),
    campaign_tag: Optional[str] = Query(default=None, max_length=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    rows, totals = export_data(date_from, date_to, status, campaign_tag, db, current_user)
    try:
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import landscape, A4
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.enums import TA_LEFT
        from reportlab.lib.units import mm
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
    except ImportError:
        raise HTTPException(status_code=500, detail="Thiếu thư viện reportlab. Vui lòng cài dependencies backend.")

    bundled_fonts = Path(__file__).resolve().parent.parent / "assets" / "fonts"
    font_candidates = [
        bundled_fonts / "DejaVuSans.ttf",
        Path("C:/Windows/Fonts/arial.ttf"),
        Path("C:/Windows/Fonts/ARIAL.TTF"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        Path("/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf"),
    ]
    bold_candidates = [
        bundled_fonts / "DejaVuSans-Bold.ttf",
        Path("C:/Windows/Fonts/arialbd.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
        Path("/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf"),
    ]
    regular_path = next((path for path in font_candidates if path.exists()), None)
    bold_path = next((path for path in bold_candidates if path.exists()), None)
    font_regular = "Helvetica"
    font_bold = "Helvetica-Bold"
    if regular_path and bold_path:
        try:
            pdfmetrics.registerFont(TTFont("MediaHubUnicode", str(regular_path)))
            pdfmetrics.registerFont(TTFont("MediaHubUnicodeBold", str(bold_path)))
            font_regular, font_bold = "MediaHubUnicode", "MediaHubUnicodeBold"
        except Exception:
            pass

    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=landscape(A4), rightMargin=12*mm, leftMargin=12*mm, topMargin=12*mm, bottomMargin=12*mm)
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle("ReportTitle", parent=styles["Title"], fontName=font_bold, fontSize=16, leading=20)
    body_style = ParagraphStyle("ReportBody", parent=styles["Normal"], fontName=font_regular, fontSize=8, leading=10)
    story = [Paragraph("BÁO CÁO RP-03 – THỐNG KÊ BÀI VIẾT", title_style), Spacer(1, 5*mm)]
    story.append(Paragraph(f"Số bài: {totals['posts']} | Lượt thích: {totals['likes']} | Bình luận: {totals['comments']} | Chia sẻ: {totals['shares']} | Lượt xem: {totals['views']}", body_style))
    story.append(Spacer(1, 4*mm))
    table_data = [["ID", "Tiêu đề", "Trạng thái", "Chiến dịch", "Ngày đo", "Like", "Comment", "Share", "View", "Nguồn"]]
    for row in rows:
        title = (row["title"] or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        tag = (row["campaign_tag"] or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        table_data.append([str(row["post_id"]), Paragraph(title, body_style), row["status"], Paragraph(tag, body_style), row["collected_at"][:16].replace("T", " "), str(row["likes"]), str(row["comments"]), str(row["shares"]), str(row["views"]), row["source"]])
    table = Table(table_data, repeatRows=1, colWidths=[12*mm, 65*mm, 22*mm, 28*mm, 28*mm, 12*mm, 16*mm, 14*mm, 14*mm, 18*mm])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0,0),(-1,0),colors.HexColor("#24352B")),
        ("TEXTCOLOR", (0,0),(-1,0),colors.white),
        ("FONTNAME", (0,0),(-1,-1),font_regular),
        ("FONTNAME", (0,0),(-1,0),font_bold),
        ("FONTSIZE", (0,0),(-1,-1),7),
        ("GRID", (0,0),(-1,-1),0.25,colors.HexColor("#D9E0D9")),
        ("VALIGN", (0,0),(-1,-1),"TOP"),
        ("ROWBACKGROUNDS", (0,1),(-1,-1),[colors.white, colors.HexColor("#F3F6F2")]),
        ("LEFTPADDING", (0,0),(-1,-1),3),
        ("RIGHTPADDING", (0,0),(-1,-1),3),
    ]))
    story.append(table)
    doc.build(story)
    buffer.seek(0)
    filename = f"RP03_bao_cao_{filename_stamp()}.pdf"
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )
