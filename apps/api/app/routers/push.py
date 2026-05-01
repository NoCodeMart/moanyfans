from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from ..auth import CurrentUser, get_current_user
from ..config import Settings, get_settings
from ..services.push import public_key_b64

router = APIRouter(tags=["push"])


class PushKeys(BaseModel):
    p256dh: str = Field(min_length=10, max_length=200)
    auth: str = Field(min_length=10, max_length=80)


class SubscribeBody(BaseModel):
    endpoint: str = Field(min_length=10, max_length=2000)
    keys: PushKeys


@router.get("/push/vapid-key")
async def vapid_key(settings: Settings = Depends(get_settings)) -> dict[str, str]:
    key = public_key_b64(settings)
    if not key:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Push not configured.")
    return {"public_key": key}


@router.post("/me/push/subscribe", status_code=status.HTTP_201_CREATED)
async def subscribe(
    body: SubscribeBody,
    request: Request,
    user: CurrentUser = Depends(get_current_user),
) -> dict[str, str]:
    if not body.endpoint.startswith(("https://fcm.googleapis.com/", "https://updates.push.services.mozilla.com/",
                                      "https://wns2-", "https://push.apple.com/")):
        # Whitelist the major push services. Stops a malicious client
        # registering an attacker-controlled endpoint that we'd then attempt
        # to deliver authenticated payloads to.
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unrecognised push endpoint.")
    pool = request.app.state.pool
    ua = (request.headers.get("user-agent") or "")[:300]
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (endpoint) DO UPDATE
              SET p256dh  = EXCLUDED.p256dh,
                  auth    = EXCLUDED.auth,
                  user_agent = EXCLUDED.user_agent,
                  last_used_at = now()
              -- Don't let one user hijack another user's existing endpoint;
              -- only the original owner can re-register their subscription.
              WHERE push_subscriptions.user_id = EXCLUDED.user_id
            """,
            user.id, body.endpoint, body.keys.p256dh, body.keys.auth, ua,
        )
    return {"status": "subscribed"}


class UnsubscribeBody(BaseModel):
    endpoint: str


@router.post("/me/push/unsubscribe")
async def unsubscribe(
    body: UnsubscribeBody,
    request: Request,
    user: CurrentUser = Depends(get_current_user),
) -> dict[str, str]:
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        await conn.execute(
            "DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2",
            user.id, body.endpoint,
        )
    return {"status": "unsubscribed"}
