import os
import sys
import json
import sqlite3
from datetime import datetime

# Add app to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.core.database import get_connection
from app.services.review_service import review_service
from app.services.audit_service import audit_service

def restore():
    print("Starting database restore from datasets folder...")
    datasets_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "datasets"))
    
    with get_connection() as conn:
        jobs = conn.execute("SELECT id, source, status, mode, filters FROM scraper_jobs").fetchall()
        
    print(f"Found {len(jobs)} scraper jobs in database.")
    
    restored_reviews = 0
    restored_approvals = 0
    
    for job in jobs:
        job_id = job["id"]
        source = job["source"]
        status = job["status"]
        mode = job["mode"]
        filters_str = job["filters"]
        
        decisions_path = os.path.join(datasets_dir, f"{job_id}_review_decisions.json")
        input_path = os.path.join(datasets_dir, f"{job_id}_input.json")
        
        # We restore if there's a decisions file
        if not os.path.exists(decisions_path):
            continue
            
        print(f"Restoring review data for Job {job_id} ({source}) - Status: {status}...")
        
        try:
            with open(decisions_path, "r", encoding="utf-8") as f:
                decisions = json.load(f)
        except Exception as e:
            print(f"  Error reading decisions for {job_id}: {e}")
            continue
            
        # Group decisions by record_index
        by_record = {}
        for d in decisions:
            idx = d.get("record_index", 0)
            if idx not in by_record:
                by_record[idx] = []
            by_record[idx].append(d)
            
        # Try loading original input data if available to get company names
        input_records = []
        if os.path.exists(input_path):
            try:
                with open(input_path, "r", encoding="utf-8") as f:
                    input_records = json.load(f)
            except Exception:
                pass
                
        # For each record
        for idx, decs in by_record.items():
            # Get company name
            company = "Unknown"
            if idx < len(input_records):
                rec = input_records[idx]
                company = rec.get("company_name") or rec.get("company") or rec.get("legal_name") or rec.get("name") or "Unknown"
                
            # If still unknown, check in decisions
            if company == "Unknown":
                for d in decs:
                    if d.get("previous_value") and d.get("previous_value") != "—":
                        company = d["previous_value"]
                        break
            if company == "Unknown":
                company = f"Record {idx + 1}"
                
            # Construct suggested changes
            suggested_changes = {}
            field_comparisons = []
            reasons = ["Restored from historical review decisions"]
            
            for d in decs:
                attr = d["attribute"]
                prev_val = d.get("previous_value") or "—"
                enr_val = d.get("enriched_value") or "—"
                admv = d.get("admv_status") or "V"
                action = d.get("reviewer_action") or "accepted"
                
                suggested_changes[attr] = enr_val
                field_comparisons.append({
                    "field": attr,
                    "existing_value": prev_val,
                    "suggested_value": enr_val,
                    "confidence": 0.9,
                    "source": source,
                    "status": "match" if admv == "V" else "diff"
                })
                
            # Create review entry (as pending)
            try:
                # We delete any existing pending or approved entry for this record in this dataset
                with get_connection() as conn:
                    conn.execute("DELETE FROM review_items WHERE dataset_id = ? AND company = ?", (job_id, company))
                    conn.execute("DELETE FROM approved_records WHERE dataset_id = ? AND company = ?", (job_id, company))
                    conn.commit()
                
                entry = review_service.create_review(
                    dataset_id=job_id,
                    dataset_name=source,
                    company=company,
                    confidence=90,
                    reasons=reasons,
                    suggested_changes=suggested_changes,
                    sources_checked=[],
                    field_comparisons=field_comparisons,
                    source_website=source,
                    website_candidates=[],
                    uploaded_row={},
                    scraped_metadata={},
                    comparison={},
                    confidence_reasons=[]
                )
                restored_reviews += 1
                
                # If the job status is Completed, approve the review
                if status == "Completed":
                    # Determine approved values based on reviewer decisions
                    approved_values = {}
                    for d in decs:
                        attr = d["attribute"]
                        action = d.get("reviewer_action") or "accepted"
                        if action == "accepted":
                            approved_values[attr] = d.get("enriched_value")
                        else:
                            approved_values[attr] = d.get("previous_value")
                            
                    review_service.approve_review(entry["id"], approved_values=approved_values)
                    
                    # Log audit event
                    orig_vals = {}
                    disc_vals = {}
                    changed_fds = []
                    for d in decs:
                        attr = d["attribute"]
                        orig_vals[attr] = d.get("previous_value")
                        disc_vals[attr] = d.get("enriched_value")
                        if d.get("reviewer_action") == "accepted":
                            changed_fds.append(attr)

                    audit_service.log_event(
                        event_type="review_approved",
                        dataset_id=job_id,
                        record_id=entry["record_id"],
                        review_id=entry["id"],
                        company=company,
                        original_values=orig_vals,
                        discovered_values=disc_vals,
                        changed_fields=changed_fds,
                        approval_path="manual",
                        metadata={"restored": True}
                    )
                    restored_approvals += 1
            except Exception as e:
                print(f"  Error creating/approving review for {company}: {e}")
                
    print(f"Restoration complete. Restored {restored_reviews} reviews and {restored_approvals} approvals.")

if __name__ == "__main__":
    restore()
