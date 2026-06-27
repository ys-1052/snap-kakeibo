from unittest.mock import MagicMock, patch

import pytest
from backend.main import app, verify_line_signature
from fastapi.testclient import TestClient

client = TestClient(app)

DUMMY_USER = {"sub": "user_id_123", "email": "test@example.com", "groups": ["Free"]}


@pytest.fixture(autouse=True)
def mock_dynamodb():
    with patch("backend.main.dynamodb") as mock_db:
        mock_table = MagicMock()
        mock_db.Table.return_value = mock_table
        yield mock_table


def test_verify_line_signature():
    # LINE_CHANNEL_SECRETが設定されていない場合は、検証は常にTrueを返す
    with patch("backend.main.LINE_CHANNEL_SECRET", None):
        assert verify_line_signature(b"body", "signature") is True

    with patch("backend.main.LINE_CHANNEL_SECRET", "secret"):
        # 正しい署名の場合
        # hmac.new(b'secret', b'body', hashlib.sha256) -> base64
        import base64
        import hashlib
        import hmac

        h = hmac.new(b"secret", b"body", hashlib.sha256).digest()
        sig = base64.b64encode(h).decode("utf-8")
        assert verify_line_signature(b"body", sig) is True

        # 間違った署名の場合
        assert verify_line_signature(b"body", "invalid_sig") is False


def test_link_line_account_mock_success(mock_dynamodb):
    """Test LINE account linking with mock auth enabled."""
    from backend.main import get_current_user

    app.dependency_overrides[get_current_user] = lambda: DUMMY_USER

    with patch("backend.main.os.environ") as mock_env:
        # Mock environment to simulate MOCK_AUTH_ENABLED=true
        mock_env.get.side_effect = lambda key, default=None: (
            "true" if key == "MOCK_AUTH_ENABLED" else default
        )

        payload = {"id_token": "Umock_line_user_12345"}
        response = client.post("/api/line/link", json=payload)

        assert response.status_code == 200
        assert response.json()["status"] == "success"

        # DynamoDB table.put_item should be called twice (one for LINE#, one for USER#)
        assert mock_dynamodb.put_item.call_count == 2

    app.dependency_overrides.clear()


def test_get_line_link_status_unlinked(mock_dynamodb):
    """Test getting LINE connection status when not linked."""
    from backend.main import get_current_user

    app.dependency_overrides[get_current_user] = lambda: DUMMY_USER

    mock_dynamodb.get_item.return_value = {}  # No item found

    response = client.get("/api/line/status")
    assert response.status_code == 200
    assert response.json() == {"linked": False}

    app.dependency_overrides.clear()


def test_get_line_link_status_linked(mock_dynamodb):
    """Test getting LINE connection status when linked."""
    from backend.main import get_current_user

    app.dependency_overrides[get_current_user] = lambda: DUMMY_USER

    mock_dynamodb.get_item.return_value = {"Item": {"line_user_id": "U12345"}}

    response = client.get("/api/line/status")
    assert response.status_code == 200
    assert response.json() == {"linked": True, "line_user_id": "U12345"}

    app.dependency_overrides.clear()


def test_unlink_line_account(mock_dynamodb):
    """Test unlinking LINE account."""
    from backend.main import get_current_user

    app.dependency_overrides[get_current_user] = lambda: DUMMY_USER

    # Mock connection exists
    mock_dynamodb.get_item.return_value = {"Item": {"line_user_id": "U12345"}}

    response = client.delete("/api/line/link")
    assert response.status_code == 200
    assert response.json() == {
        "status": "success",
        "message": "LINE account unlinked successfully",
    }

    # DynamoDB delete_item should be called twice
    assert mock_dynamodb.delete_item.call_count == 2

    app.dependency_overrides.clear()


@patch("backend.main.verify_line_signature", return_value=True)
@patch("backend.main.line_reply_message")
def test_line_webhook_unlinked(mock_reply, mock_sig, mock_dynamodb):
    """Test webhook when LINE user is not linked to a web account."""
    mock_dynamodb.get_item.return_value = {}  # LINE user not linked

    payload = {
        "events": [
            {
                "type": "message",
                "replyToken": "dummy_reply_token",
                "source": {"userId": "U_unlinked_user", "type": "user"},
                "message": {"id": "msg_123", "type": "image"},
            }
        ],
        "destination": "dest_123",
    }

    response = client.post(
        "/api/line/webhook", json=payload, headers={"X-Line-Signature": "dummy"}
    )
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}

    # Reply message should be sent warning about unlinked status
    mock_reply.assert_called_once()
    assert "アカウント連携" in mock_reply.call_args[0][1]


@patch("backend.main.verify_line_signature", return_value=True)
@patch("backend.main.line_reply_message")
@patch("backend.main._process_line_receipt")
def test_line_webhook_linked_local_async(
    mock_process, mock_reply, mock_sig, mock_dynamodb
):
    """Test webhook when LINE user is linked, running async process locally."""
    # Mock linked connection
    mock_dynamodb.get_item.return_value = {"Item": {"user_id": "user_123"}}

    payload = {
        "events": [
            {
                "type": "message",
                "replyToken": "dummy_reply_token",
                "source": {"userId": "U_linked_user", "type": "user"},
                "message": {"id": "msg_123", "type": "image"},
            }
        ],
        "destination": "dest_123",
    }

    with patch("backend.main.os.environ") as mock_env:
        # Simulate local development mode
        mock_env.get.side_effect = lambda key, default=None: (
            "true" if key == "MOCK_AUTH_ENABLED" else default
        )

        # Note: TestClient in FastAPI will run background tasks synchronously during tests
        response = client.post(
            "/api/line/webhook", json=payload, headers={"X-Line-Signature": "dummy"}
        )

        assert response.status_code == 200
        assert response.json() == {"status": "ok"}

        # Immediate reply sent
        mock_reply.assert_called_once()
        assert "画像を受信しました" in mock_reply.call_args[0][1]

        # Async task runs (mocked process_line_receipt is called)
        mock_process.assert_called_once_with("U_linked_user", "user_123", "msg_123")
