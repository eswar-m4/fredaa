from mod import helper
import json
if __name__=="__main__":
    print(json.dumps({"records": [{"name": helper()}], "execution_metadata": {"mode": "script"}}))
