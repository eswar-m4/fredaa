from app.core.database import get_connection

JOB_ID = "J-1784913570502"

with get_connection() as conn:
    row = conn.execute(
        """
        select id, source, status, mode, frequency, refresh_count, records,
               changes_detected, last_refresh, next_refresh
          from scraper_jobs
         where id = ?
        """,
        (JOB_ID,),
    ).fetchone()
    print(dict(row) if row else None)

    rows = conn.execute(
        """
        select name, url, package_path, package_files_json
          from bot_catalog
         where name like ? or url like ?
        """,
        ("%NationalGrid%", "%nationalgas.com%"),
    ).fetchall()
    print([dict(r) for r in rows])
