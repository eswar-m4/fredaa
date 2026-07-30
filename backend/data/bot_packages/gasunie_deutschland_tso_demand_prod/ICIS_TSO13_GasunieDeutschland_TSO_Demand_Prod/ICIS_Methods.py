import pandas as pd
import os
import re
import datetime
import smtplib
import requests
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

def serverIP():
    try:
        response = requests.get('https://api.ipify.org?format=json')
        response.raise_for_status()
        ip_address = response.json().get('ip')
        
        with open('ipaddress.txt', 'w') as ipfile:
            ipfile.write(ip_address)
        return ip_address
    except (requests.RequestException, ValueError):
        if os.path.exists('ipaddress.txt') and os.path.getsize('ipaddress.txt') > 0:
            try:
                with open('ipaddress.txt', 'r') as ipfile:
                    ip_address = ipfile.read().strip()
                return ip_address
            except IOError:
                pass
        return "1.1.1.1"
        

def datetime_operation(date_time_str, operation, type_, time):
    dt = datetime.datetime.strptime(date_time_str, '%Y-%m-%d %H:%M:%S')
    if operation == 'add': dt += datetime.timedelta(**{type_: time})
    else:  dt -= datetime.timedelta(**{type_: time})
    return dt

def regex_match(regex,content):
    match=re.search(regex,content,flags=re.I)
    if match:
        return match.group(1)
    return ''

def get_excelDict(file_name):
    excelDict={}
    if file_name.endswith('.xlsx'):
        excelData =  pd.read_excel(file_name, sheet_name=None, engine='openpyxl')
    elif file_name.endswith('.xls'):
        excelData=  pd.read_excel(file_name, sheet_name=None, engine='xlrd')
    else:
        excelData = pd.read_excel(file_name, sheet_name=None)
        
    for sheet_name, df in excelData.items():
        excelDict[sheet_name.strip()] = df.to_dict(orient='records')
        records = df.to_dict(orient='records')
        cleaned_records = []
        for record in records:
            cleaned_record = {}
            for key, value in record.items():
                cleaned_key = ' '.join(str(key).strip().split())
                cleaned_record[cleaned_key] = value
            cleaned_records.append(cleaned_record)
        excelDict[sheet_name.strip()] = cleaned_records  
    return excelDict
    
def dayLightSaving():
    days={'Sunday':7,'Monday':6,'Tuesday':5,'Wednesday':4,'Thursday':3,'Friday':2,'Saturday':1}
    date = datetime.datetime.utcnow()
    day_name = date.strftime('%A')
    month = int(date.strftime('%m'))
    day = int(date.strftime('%d'))
    diff=31-day
    if((month>3 and month<10) or ((diff<days[day_name] and month==3) or (diff>days[day_name]-1 and month==10))):
        return date+datetime.timedelta(hours=1)
    return date


def makeDirectory(folders):
    try:
        for folder in folders:
            if not os.path.exists(folder):os.makedirs(folder)
    except:
        if not os.path.exists(folders):os.makedirs(folders)  
        
def errorMail(serverIP='', error='', mailData=[]):
    mailTrigger, emailUser, emailPassword, senderEmail, receiverEmails = mailData
    if mailTrigger:
        mailData = f"""
        {serverIP}, {os.path.dirname(os.path.abspath(__file__))}, {os.path.basename(__file__)}, {error}
        """
        msg = MIMEMultipart()
        msg['From'] = senderEmail
        msg['To'] = ', '.join(receiverEmails)
        msg['Subject'] = 'Script Error Detail Report'        
        body = "<html><body><p>Hi Team,</p><p>Here are the error details:</p><table border='1'><tr><th>Server IP</th><th>Folder</th><th>Script Name</th><th>Error</th></tr>"
        for line in mailData.strip().split('\n'):
            body += "<tr>"
            for item in line.split(','):
                body += f"<td>{item.strip()}</td>"
            body += "</tr>"
        body += "</table><p>Regards,</p><p>ICIS Team</p></body></html>"
        msg.attach(MIMEText(body, 'html'))
        server = smtplib.SMTP('smtp.gmail.com', 587)
        server.starttls()
        server.login(emailUser, emailPassword)
        text = msg.as_string()
        server.sendmail(senderEmail, receiverEmails, text)  
        server.quit()
        print('Error Mail Sent Successfully')        
        
def file_write(name,mode,data):
    try:
        with open(name,mode,encoding='utf-8') as fh:
            fh.write(data)
    except:        
        with open(name,mode) as fh:
            fh.write(data)

def file_read(name,mode):
    print(f"In file1Read...{name}")
    try:
        with open(name,mode,encoding='utf-8') as fh:
            data=fh.read()
    except:        
        with open(name,mode) as fh:
            data=fh.read()
    return data 
        