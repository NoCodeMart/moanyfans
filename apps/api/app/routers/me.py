from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..auth import CurrentUser, get_current_user
from ..config import Settings, get_settings

router = APIRouter(tags=["me"])


class MeResponse(BaseModel):
    id: str
    handle: str
    email: str
    team_id: str | None
    is_admin: bool
    is_house_account: bool
    auth_enabled: bool


@router.get("/me", response_model=MeResponse)
async def me(
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> MeResponse:
    return MeResponse(
        id=user.id,
        handle=user.handle,
        email=user.email,
        team_id=user.team_id,
        is_admin=user.is_admin,
        is_house_account=user.is_house_account,
        auth_enabled=settings.auth_enabled,
    )
