from fastapi import APIRouter, Depends, UploadFile

from ..auth import CurrentUser, get_current_user
from ..services.media import store_upload
from ..services.ratelimit import limit_user

router = APIRouter(prefix="/media", tags=["media"])


@router.post("")
async def upload(
    file: UploadFile,
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Authenticated image upload. Returns the descriptor to attach to a moan."""
    limit_user(user, action="upload_media", limit=20, window_s=300)
    stored = await store_upload(file)
    return {
        "media_path": stored.path,
        "media_w": stored.width,
        "media_h": stored.height,
        "media_mime": stored.mime,
    }
