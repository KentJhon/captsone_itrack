# backend/routers/items.py
from typing import Optional

from fastapi import APIRouter, Form, Cookie, HTTPException
import mysql.connector

from db import get_db
from security.jwt_tools import verify_token
from security.deps import COOKIE_NAME_AT
from routers.activity_logger import log_activity

router = APIRouter(prefix="/items", tags=["Items"])


def _actor_id_from_cookie(access_token: str | None) -> Optional[int]:
    if not access_token:
        return None
    try:
        claims = verify_token(access_token)
        if claims.get("type") == "access":
            return int(claims["sub"])
    except Exception:
        return None
    return None


# ✅ READ: Fetch all items
@router.get("/")
def get_items():
    conn = get_db()
    cursor = conn.cursor(dictionary=True)
    cursor.execute("SELECT * FROM item")
    items = cursor.fetchall()
    cursor.close()
    conn.close()
    return items


# ✅ CREATE: Add a new item
@router.post("/")
def add_item(
    name: str = Form(...),
    unit: str = Form(...),
    category: str = Form(...),
    price: float = Form(...),
    stock_quantity: int = Form(...),
    reorder_level: int = Form(...),
    access_token: str | None = Cookie(default=None, alias=COOKIE_NAME_AT),
):
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            INSERT INTO item (name, unit, category, price, stock_quantity, reorder_level)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (name, unit, category, price, stock_quantity, reorder_level),
        )
        conn.commit()
        item_id = cursor.lastrowid
    except mysql.connector.Error:
        conn.rollback()
        raise
    finally:
        cursor.close()
        conn.close()

    actor_id = _actor_id_from_cookie(access_token)
    log_activity(
        actor_id,
        "Create",
        f"Added inventory item #{item_id} ({name}), category={category}, stock={stock_quantity}.",
    )

    return {"message": "Item added successfully", "item_id": item_id}


# ✅ UPDATE: Modify an existing item (includes Edit + Add Stock flow via PUT)
@router.put("/{item_id}")
def update_item(
    item_id: int,
    name: str = Form(...),
    unit: str = Form(...),
    category: str = Form(...),
    price: float = Form(...),
    stock_quantity: int = Form(...),
    reorder_level: int = Form(...),
    access_token: str | None = Cookie(default=None, alias=COOKIE_NAME_AT),
):
    conn = get_db()
    # use dictionary=True so we can inspect old values
    cursor = conn.cursor(dictionary=True)
    try:
        # Get existing row first
        cursor.execute("SELECT * FROM item WHERE item_id=%s", (item_id,))
        old_row = cursor.fetchone()
        if not old_row:
            raise HTTPException(status_code=404, detail="Item not found")

        old_name = old_row["name"]
        old_unit = old_row["unit"]
        old_category = old_row["category"]
        old_price = float(old_row["price"])
        old_stock = int(old_row["stock_quantity"])
        old_reorder_level = int(old_row["reorder_level"])

        # Do update
        cursor.execute(
            """
            UPDATE item
            SET name=%s, unit=%s, category=%s, price=%s, stock_quantity=%s, reorder_level=%s
            WHERE item_id=%s
            """,
            (name, unit, category, price, stock_quantity, reorder_level, item_id),
        )
        conn.commit()
    except mysql.connector.Error:
        conn.rollback()
        raise
    finally:
        cursor.close()
        conn.close()

    actor_id = _actor_id_from_cookie(access_token)

    # Build a detailed description
    desc_parts = []

    # Detect stock change → this covers your "Add Stock" flow (since it uses PUT)
    if stock_quantity != old_stock:
        diff = stock_quantity - old_stock
        if diff > 0:
            desc_parts.append(
                f"added {diff} units (stock {old_stock} → {stock_quantity})"
            )
        else:
            desc_parts.append(
                f"reduced stock {old_stock} → {stock_quantity}"
            )

    # Detect other field changes (edit item details)
    if name != old_name:
        desc_parts.append(f"name '{old_name}' → '{name}'")
    if unit != old_unit:
        desc_parts.append(f"unit '{old_unit}' → '{unit}'")
    if category != old_category:
        desc_parts.append(f"category '{old_category}' → '{category}'")
    if float(price) != old_price:
        desc_parts.append(f"price {old_price} → {price}")
    if int(reorder_level) != old_reorder_level:
        desc_parts.append(
            f"reorder_level {old_reorder_level} → {reorder_level}"
        )

    if desc_parts:
        desc = "Updated inventory item #{item_id} ({name}): " + ", ".join(desc_parts)
        desc = desc.format(item_id=item_id, name=name)
    else:
        # No visible change, but log anyway
        desc = f"Updated inventory item #{item_id} ({name}) with no field changes."

    log_activity(
        actor_id,
        "Update",
        desc,
    )

    return {"message": "Item updated successfully"}


# ✅ DELETE: Remove an item
@router.delete("/{item_id}")
def delete_item(
    item_id: int,
    access_token: str | None = Cookie(default=None, alias=COOKIE_NAME_AT),
):
    conn = get_db()
    cursor = conn.cursor(dictionary=True)
    try:
        # Fetch item for nicer log message
        cursor.execute("SELECT name, category, stock_quantity FROM item WHERE item_id=%s", (item_id,))
        row = cursor.fetchone()

        cursor.execute("DELETE FROM item WHERE item_id=%s", (item_id,))
        conn.commit()
    except mysql.connector.Error:
        conn.rollback()
        raise
    finally:
        cursor.close()
        conn.close()

    actor_id = _actor_id_from_cookie(access_token)

    if row:
        desc = (
            f"Deleted inventory item #{item_id} ({row['name']}), "
            f"category={row['category']}, last_stock={row['stock_quantity']}."
        )
    else:
        desc = f"Deleted inventory item #{item_id}."

    log_activity(
        actor_id,
        "Delete",
        desc,
    )

    return {"message": "Item deleted successfully"}


# ✅ ADD STOCK ONLY: Adjust stock and log it
@router.post("/{item_id}/add_stock")
def add_stock(
    item_id: int,
    added_qty: int = Form(...),
    access_token: str | None = Cookie(default=None, alias=COOKIE_NAME_AT),
):
    """
    Increment stock_quantity for an existing item.
    This is for 'add stock' operations (e.g., new delivery).
    """
    conn = get_db()
    cursor = conn.cursor(dictionary=True)

    try:
        # Get current item info
        cursor.execute(
            "SELECT name, stock_quantity FROM item WHERE item_id = %s",
            (item_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Item not found")

        old_stock = int(row["stock_quantity"])
        new_stock = old_stock + added_qty

        # Update stock
        cursor.execute(
            """
            UPDATE item
            SET stock_quantity = %s
            WHERE item_id = %s
            """,
            (new_stock, item_id),
        )
        conn.commit()

    except mysql.connector.Error:
        conn.rollback()
        raise
    finally:
        cursor.close()
        conn.close()

    actor_id = _actor_id_from_cookie(access_token)
    # description starts with "Updated inventory item" so it shows up
    # in /activity-logs/highlights (pattern: 'Updated inventory item%')
    log_activity(
        actor_id,
        "Update",
        f"Updated inventory item #{item_id} ({row['name']}): "
        f"added {added_qty} units (stock {old_stock} → {new_stock}).",
    )

    return {
        "message": "Stock updated successfully",
        "item_id": item_id,
        "old_stock": old_stock,
        "new_stock": new_stock,
    }
