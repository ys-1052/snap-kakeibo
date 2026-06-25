from unittest.mock import MagicMock, patch

import pytest

# Needs to be imported like this since tests might be run from the root directory or backend directory
from backend.main import app
from fastapi.testclient import TestClient

client = TestClient(app)

# Create a dummy user dictionary for the mock to return
DUMMY_USER = {"sub": "user_id_123"}


@pytest.fixture(autouse=True)
def mock_dynamodb():
    with patch("backend.main.dynamodb") as mock_db:
        mock_table = MagicMock()
        mock_db.Table.return_value = mock_table
        yield mock_db


def test_analyze_receipt_invalid_file_key_not_uploads():
    """Test that file keys not starting with 'uploads/' are rejected."""
    payload = {"file_key": "secret.txt"}

    # Mock authentication to allow request through
    with patch("backend.main.get_current_user", return_value=DUMMY_USER):
        # We also need to override the dependency directly if patch doesn't cover it
        app.dependency_overrides[app.router.routes[2].endpoint] = lambda: (
            DUMMY_USER
        )  # Just in case, override get_current_user logic

        # Use app.dependency_overrides to bypass auth if simply patching doesn't work.
        from backend.main import get_current_user

        app.dependency_overrides[get_current_user] = lambda: DUMMY_USER

        response = client.post(
            "/api/receipts/analyze",
            json=payload,
        )

        # Cleanup overrides
        app.dependency_overrides.clear()

        assert response.status_code == 400
        assert "Must start with 'uploads/'" in response.json()["detail"]


def test_analyze_receipt_invalid_file_key_path_traversal():
    """Test that file keys containing '..' are rejected."""
    payload = {"file_key": "uploads/../../secret.txt"}

    with patch("backend.main.get_current_user", return_value=DUMMY_USER):
        from backend.main import get_current_user

        app.dependency_overrides[get_current_user] = lambda: DUMMY_USER

        response = client.post(
            "/api/receipts/analyze",
            json=payload,
        )

        app.dependency_overrides.clear()

        assert response.status_code == 400
        assert "Path traversal not allowed" in response.json()["detail"]


@patch("backend.main.s3_client")
def test_analyze_receipt_valid_file_key(mock_s3_client):
    """Test that a valid file key passes validation and calls S3."""
    payload = {"file_key": "uploads/valid_receipt.jpg"}

    # Mock S3 response
    mock_response = MagicMock()
    mock_body = MagicMock()
    mock_body.read.return_value = b"fake_image_bytes"
    mock_response.__getitem__.return_value = mock_body
    mock_s3_client.get_object.return_value = mock_response

    with (
        patch("backend.main.get_current_user", return_value=DUMMY_USER),
        patch("backend.main.bedrock_client") as mock_bedrock,
    ):
        # We just want to check if get_object is called and validation passes
        # Bedrock mocking to prevent real API calls and make it return a valid result
        mock_bedrock_response = {
            "output": {
                "message": {
                    "content": [
                        {
                            "text": '```json\n{"transaction_date": "2023-10-10", "shop_name": "Test Shop", "total_amount": 1000, "category_name": "Test", "items": [], "tax_summary": []}\n```'
                        }
                    ]
                }
            }
        }
        mock_bedrock.converse.return_value = mock_bedrock_response

        from backend.main import get_current_user

        app.dependency_overrides[get_current_user] = lambda: DUMMY_USER

        response = client.post(
            "/api/receipts/analyze",
            json=payload,
        )

        app.dependency_overrides.clear()

        assert response.status_code == 200
        from backend.main import BUCKET_NAME

        mock_s3_client.get_object.assert_called_once_with(
            Bucket=BUCKET_NAME,
            Key="uploads/valid_receipt.jpg",
        )


@patch("backend.main.s3_client")
def test_analyze_receipt_float_price_coercion(mock_s3_client):
    """Test that float values in receipt items and totals are successfully coerced to integers."""
    payload = {"file_key": "uploads/valid_receipt.jpg"}

    # Mock S3 response
    mock_response = MagicMock()
    mock_body = MagicMock()
    mock_body.read.return_value = b"fake_image_bytes"
    mock_response.__getitem__.return_value = mock_body
    mock_s3_client.get_object.return_value = mock_response

    with (
        patch("backend.main.get_current_user", return_value=DUMMY_USER),
        patch("backend.main.bedrock_client") as mock_bedrock,
    ):
        # Bedrock response contains float values for price, total_amount, tax_rate, and taxable_amount
        mock_bedrock_response = {
            "output": {
                "message": {
                    "content": [
                        {
                            "text": '```json\n{\n  "transaction_date": "2026-06-16",\n  "shop_name": "Test Shop",\n  "total_amount": 1331.0,\n  "category_name": "食費",\n  "items": [\n    {\n      "name": "ホットドッグロール",\n      "price": 27.8,\n      "qty": 5.0,\n      "tax_rate": 8.0,\n      "tax_included": false,\n      "tax_marker": "*"\n    }\n  ],\n  "tax_summary": [\n    {\n      "tax_rate": 8.0,\n      "taxable_amount": 1288.0,\n      "tax_amount": 103.0,\n      "tax_included": false\n    }\n  ]\n}\n```'
                        }
                    ]
                }
            }
        }
        mock_bedrock.converse.return_value = mock_bedrock_response

        from backend.main import get_current_user

        app.dependency_overrides[get_current_user] = lambda: DUMMY_USER

        response = client.post(
            "/api/receipts/analyze",
            json=payload,
        )

        app.dependency_overrides.clear()

        assert response.status_code == 200
        data = response.json()
        assert data["total_amount"] == 1331
        assert data["items"][0]["price"] == 28
        assert data["items"][0]["qty"] == 5

        assert data["items"][0]["tax_rate"] == 8
        assert data["tax_summary"][0]["tax_rate"] == 8
        assert data["tax_summary"][0]["taxable_amount"] == 1288
        assert data["tax_summary"][0]["tax_amount"] == 103
