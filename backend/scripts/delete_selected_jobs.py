import os
import sys

# Add backend directory to PYTHONPATH
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.core.database import get_connection

JOBS_TO_DELETE = [
    "J-1782447970106",
    "J-1782206517297",
    "J-1782106369073",
    "J-VERIFY-101",
    "J-1781791566748",
    "J-1781264793"
]

def clean_database():
    print(f"Starting database cleanup for {len(JOBS_TO_DELETE)} jobs...")
    
    with get_connection() as conn:
        # Delete from scraper_jobs
        cur = conn.execute(
            "DELETE FROM scraper_jobs WHERE id IN ({})".format(",".join("?" for _ in JOBS_TO_DELETE)),
            JOBS_TO_DELETE
        )
        print(f"Deleted {cur.rowcount} rows from scraper_jobs.")

        # Delete from review_items
        cur = conn.execute(
            "DELETE FROM review_items WHERE dataset_id IN ({})".format(",".join("?" for _ in JOBS_TO_DELETE)),
            JOBS_TO_DELETE
        )
        print(f"Deleted {cur.rowcount} rows from review_items.")

        # Delete from approved_records
        cur = conn.execute(
            "DELETE FROM approved_records WHERE dataset_id IN ({})".format(",".join("?" for _ in JOBS_TO_DELETE)),
            JOBS_TO_DELETE
        )
        print(f"Deleted {cur.rowcount} rows from approved_records.")

        # Delete from audit_events
        cur = conn.execute(
            "DELETE FROM audit_events WHERE dataset_id IN ({})".format(",".join("?" for _ in JOBS_TO_DELETE)),
            JOBS_TO_DELETE
        )
        print(f"Deleted {cur.rowcount} rows from audit_events.")

        conn.commit()
    print("Database cleanup committed successfully!")

if __name__ == "__main__":
    clean_database()
