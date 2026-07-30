import re
import sys
import os
import glob
import json
import traceback
import time
import warnings
import shutil
from datetime import datetime
from datetime import timedelta
from datetime import datetime, timedelta
import hashlib
import ftplib
import urllib.parse
import requests
from bs4 import BeautifulSoup
import boto3
from urllib.parse import quote, quote_plus, unquote, unquote_plus


warnings.filterwarnings("ignore")

def ipaddress():
    if os.path.isfile('C:/SD/ip.txt'):
        file = open('C:/SD/ip.txt', 'r')
        systemIp = file.read()
        file.close()
        print('Ip Address is '+str(systemIp))
    else:
        systemIp = socket.gethostbyname(socket.gethostname())
        systemIp = re.sub('[\D]+', '.', systemIp, flags=re.I|re.M)
        print('Ip Address is '+str(systemIp))
    return systemIp

def ftp_download(ServerIP = '',Username = '',Password = '',ftp_path = '',local_path ='',pattern = ''):

    try:
        Unique = ["000"]
        ftp = ftplib.FTP(ServerIP, Username, Password)
        ftp_file_list = ftp.nlst(ftp_path)
        pattern=pattern+"_UID"
        for ftp_file in ftp_file_list:
            
            print ("pattern :: " + pattern)
            # if pattern == '19.6':
                # pattern = '19.6_'
            if pattern in ftp_file:
                file_name=os.path.basename(ftp_file)
                ftp.cwd(ftp_path)
                local_filename = os.path.join(local_path, file_name)
                gFile = open(local_filename, "wb")
                ftp.retrbinary('RETR '+file_name, gFile.write)
                gFile.close()
                with open(local_filename,'r') as fh:
                    input_rows=fh.readlines()
                unique_ids=[input_row.strip().split('\t')[-1] for input_row in input_rows]
                print("The length of list is: ", len(unique_ids))
                Unique = Unique + unique_ids
                # print(local_filename),input()
                ftp.delete(file_name)
                # return local_filename
        # print(len(Unique)),input()
        return Unique
    except:
        print(traceback.format_exc())
        return 'error'
        
    ftp.quit()

def content_fetch(url,method,parameter,header,crawlera_flag):
    print("url",url)
    global crawlera_session_id
    if crawlera_flag==1:
        if crawlera_session_id=='':
            header['X-Crawlera-Cookies']='disable'
            header['X-Crawlera-Session']='create'
        else:
            header['X-Crawlera-Cookies']='disable'
            header['X-Crawlera-Session']=crawlera_session_id
        if method=='get':
            obj=sess.get(url,headers=header,proxies=proxies,verify=False)
        else:
            obj=sess.post(url,data=parameter,headers=header,proxies=proxies,verify=False)
        if crawlera_session_id=='':
            crawlera_session_id=obj.headers["X-Crawlera-Session"]
    else:
        if method=='get':
            obj=sess.get(url,headers=header)
        else:
            obj=sess.post(url,data=parameter,headers=header)
    return obj

def regex_match(regex,content):
    match=re.search(regex,content,flags=re.I)
    if match:
        return match.group(1)
    return ''

def make_directory(path):
    if not os.path.exists(path):
        os.makedirs(path)

def clean(con):
    con=re.sub(r'<[^>]*?>',' ',str(con))
    con=re.sub(r'\n',' ',str(con))
    con=re.sub(r'\t',' ',str(con))
    con=re.sub(r'\r',' ',str(con))
    con=re.sub(r'\\n',' ',str(con))
    con=re.sub(r'\\t',' ',str(con))
    con=re.sub(r'\\r',' ',str(con))
    con = re.sub("&quot;", "\"",str(con))
    con = re.sub("&amp;", "&",str(con))
    con = re.sub("<[^>]*?>", " ",str(con))
    con = re.sub("\&\#39\;", "'",str(con))
    con=re.sub(r'\s+',' ',str(con))
    con=re.sub(r'^\s*','',str(con))
    con=re.sub(r'\s*$','',str(con))
    con=re.sub(r'\&#xa0\;','',str(con))
    
    return con
def clean1(con):
    con=re.sub(r'\n',' ',str(con))
    con=re.sub(r'\t',' ',str(con))
    con=re.sub(r'\r',' ',str(con))
    con=re.sub(r'\\n',' ',str(con))
    con=re.sub(r'\\t',' ',str(con))
    con=re.sub(r'\\r',' ',str(con))
    con = re.sub("&quot;", "\"",str(con))
    con = re.sub("&amp;", "&",str(con))
    con = re.sub("\&\#39\;", "'",str(con))
    con=re.sub(r'\&#xa0\;','',str(con))
    
    return con
    
def ac_task_result(task_id):
    while True:
        obj=requests.post('https://api.anti-captcha.com/getTaskResult',json={'clientKey':config_data['anticaptcha_key'],'taskId':task_id},headers={'Accept':'application/json','Content-Type': 'application/json'})
        if re.search('^2',str(obj.status_code)):
            result_response=obj.json()
            if result_response['errorId']==0 and result_response['status']=='ready':
                return result_response['solution']['gRecaptchaResponse']
            elif result_response['errorId']>=1:
                return 'Captcha Result Error'
            time.sleep(10)
        else:
            return 'Captcha Result Response Error'

def ac_create_task(site_key,website_url):
    obj=requests.post('https://api.anti-captcha.com/createTask',json={'clientKey':config_data['anticaptcha_key'],'task':{'type':'RecaptchaV2TaskProxyless','websiteURL':website_url,'websiteKey':site_key},'softId':0},headers={'Accept':'application/json','Content-Type':'application/json'})
    if re.search('^2',str(obj.status_code)):
        task_response=obj.json()
        if task_response['errorId']==0:
            time.sleep(15)
            return ac_task_result(task_response['taskId'])
        else:
            return 'Captcha Task Error'
    else:
        return 'Captcha Task Response Error'

def get_data_bs4(soup,tag,attr_name,attr_value,get_attr):
    if get_attr=='':
        try:
            return soup.find(tag,attrs={attr_name:attr_value}).get_text()
        except:
            return ''
    else:
        try:
            return soup.find(tag,attrs={attr_name:attr_value}).get(get_attr)
        except:
            return ''

def ftpUpload1(serverIP,userName,password,ftpPath,fileName,backup_path):
    ftp = ftplib.FTP(serverIP, userName, password)
    
    try:
        ftp.mkd(ftpPath)
    except:
        pass
    
    try:
        tempFileName= os.path.basename(fileName)
        gFile = open(fileName, 'rb')
        ftp.storbinary('STOR ' + ftpPath + '/' + tempFileName, gFile)
        gFile.close()
        shutil.move(fileName,backup_path+tempFileName)
    except:
        pass

    ftp.quit()

def ftpUpload(serverIP, userName, password, ftpPath, outputfileName):
    ftp = ftplib.FTP(serverIP, userName, password)
    try:
        ftp.mkd(ftpPath)
    except:
        pass
    try:
        tempFileName = os.path.basename(outputfileName)
        with open(outputfileName, 'rb') as gFile:
            ftp.storbinary(f'STOR {ftpPath}/{tempFileName}', gFile)
    except:
        pass
    ftp.quit()
    

if __name__=='__main__':
        
    Start_ID=sys.argv[1]
    End_ID=sys.argv[2]
    Start_ID=Start_ID.strip()
    End_ID=End_ID.strip()

    input_file=open('input.txt','r')
    input_value_list=input_file.readlines()
    input_file.close()

    d = datetime.now()
    startTime = time.strftime("%Y-%m-%d %H:%M:%S")   
    todaydate = time.strftime("%Y-%m-%d") 
    today = time.strftime("%Y-%m-%d %H:%M:%S")   
    print("startTime",startTime)
    print("todaydate",todaydate)
    print("today",today)

    systemIp=ipaddress()
    Detail_output_file="output.txt"
    file = open(Detail_output_file, 'w')
    file.write('bot_start_time\tbot_end_time\tbot_name\tversion\tProcessed_IP\tInputId\tOutputId\tmobid\tclientid\tref_id\tin_id\ttarget_site_id\ttarget_site_domain\ttarget_input_company_name\ttarget_input_code\ttarget_product_url\tCrawl date/Time\tId\tInput Company Name\tInput Code\tCompany Name\tCode\tYear\tAnnual Report Link\tComments\tprocess_final_status\tstatus_scenario\ttarget_pid\ttarget_parse_timestamp\ttarget_html_file_name\ttarget_html_file_path\terror_code\terror_message\n')
    file.close()
       
    common_cache_path='C:/BSE/Cache/'
    output_path='C:/BSE/Output/'
    make_directory(common_cache_path)
    make_directory(output_path)
        
    cachepath='C:/BSE/Cache/'+str(todaydate)+'/'
    make_directory(cachepath)


    for i in range(int(Start_ID),int(End_ID)+1):
        inp_element=input_value_list[i].split("\t")
        clientid=inp_element[0];    
        sno=inp_element[1];
        target_site_domain="bseindia.com";
        input_com_name=inp_element[3];
        input_code=inp_element[4];
        target_product_url="https://www.bseindia.com/corporates/HistoricalAnnualReport.aspx";
        clientid=clientid.strip()
        sno=sno.strip()
        target_site_domain=target_site_domain.strip()
        input_com_name=input_com_name.strip()
        input_code=input_code.strip()
        target_product_url=target_product_url.strip()
        

        sess = requests.Session()
        homeurl='https://www.bseindia.com/corporates/HistoricalAnnualReport.aspx'
        homeobj = sess.get(homeurl, headers={'upgrade-insecure-requests': '1','user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'})
        
        CachePath1 = 'Homecontent.html'
        file = open(str(CachePath1), 'wb')
        file.write(homeobj.content)
        file.close()
        homecontent=homeobj.content
         
        sess1 = requests.Session()
        suburl='https://www.bseindia.com/corporates/HistoricalAnnualReport.aspx'
        subobj=sess1.get(homeurl, headers={'upgrade-insecure-requests': '1','user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36','accept':'*/*','origin':'https://www.bseindia.com','referer':'https://www.bseindia.com/'})
        
        with open('{}subcontent_{}.html'.format(cachepath, str(sno)), 'wb') as fh:
            fh.write(subobj.content)
        subcontent=subobj.content
        
        soup = BeautifulSoup(subobj.text,'html.parser')
        view_state=soup.find('input',attrs={'name':'__VIEWSTATE'}).get('value')
        view_state_gen=soup.find('input',attrs={'name':'__VIEWSTATEGENERATOR'}).get('value')
        eventvali=soup.find('input',attrs={'name':'__EVENTVALIDATION'}).get('value')
        view_state = quote(view_state)
        view_state_gen = quote(view_state_gen)
        eventvali = quote(eventvali)
        eventvali = re.sub("\/", "%2F", eventvali, flags=re.I|re.M) 

        posturl='https://www.bseindia.com/corporates/HistoricalAnnualReport.aspx'
        
        postpara='__VIEWSTATE='+str(view_state)+'&__VIEWSTATEGENERATOR='+str(view_state_gen)+'&__VIEWSTATEENCRYPTED=&__EVENTVALIDATION='+str(eventvali)+'&ctl00%24ContentPlaceHolder1%24GetQuote1_hdnCode=&ctl00%24ContentPlaceHolder1%24SmartSearch%24hdnCode='+str(input_code)+'&ctl00%24ContentPlaceHolder1%24SmartSearch%24smartSearch='+str(input_com_name)+'&ctl00%24ContentPlaceHolder1%24hf_scripcode='+str(input_code)+'&ctl00%24ContentPlaceHolder1%24btnSubmit=Submit&ctl00%24ContentPlaceHolder1%24hdnCode='
        obj=sess1.post(posturl,postpara, headers={'accept':'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7','content-type':'application/x-www-form-urlencoded','origin':'https://www.bseindia.com','referer':'https://www.bseindia.com/corporates/HistoricalAnnualReport.aspx','upgrade-insecure-requests':'1','user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'})
        
        filename = f"{input_code}_{sno}_results.html"
        with open(filename, "wb") as fh:
            fh.write(obj.content)
        postcon=obj.content
        postcon=re.sub(r'\n',' ',str(postcon))
        postcon=re.sub(r'\t',' ',str(postcon))
        postcon=re.sub(r'\r',' ',str(postcon))
        postcon=re.sub(r'\\n',' ',str(postcon))
        postcon=re.sub(r'\\t',' ',str(postcon))
        postcon=re.sub(r'\\r',' ',str(postcon))
        postcon=re.sub(r'&#039;','\'',str(postcon))
        postcon=re.sub(r'&#8217;','’',str(postcon))
        postcon=re.sub(r'&#8211;','-',str(postcon))
        postcon=re.sub(r'&#038;','&',str(postcon))
        postcon=re.sub(r'\\\'','\'',str(postcon))
        postcon=re.sub(r'\\\/','/',str(postcon))
        postcon=re.sub(r'\\\/','/',str(postcon))
        
        bot_start_time=bot_end_time=bot_name=version=Processed_IP=InputId=OutputId=mobid=ref_id=in_id=target_site_id=Crawl_date_Time=Id=Input_Company_Name=Input_Code=Company_Name=Code=Year=Annual_Report_Link=Comments=process_final_status=status_scenario=target_pid=target_parse_timestamp=target_html_file_name=target_html_file_path=error_code=error_message=''
        bot_name="DS360_BSE_India_M2_V1.exe"
        version="1"
        
        if re.search('(<td\s*class=\"TTRow\"[^>]*?>[\d]{4,}<\/td><td\s*class=\"TTRow\">[\w\W]*?<\/a>\s*<\/td>)',str(postcon)):
            
            for blk in re.findall(r'(<td\s*class="TTRow"[^>]*?>\d{4,}</td><td\s*class="TTRow">[\w\W]*?</a>\s*</td>)',str(postcon)):
                
                m1 = re.search(r'<td\s*class=\"TTRow\"[^>]*?>([\d]{4,})<\/td><td\s*class=\"TTRow\">[\w\W]*?<\/a>\s*<\/td>',str(blk))
                Year = m1.group(1)

                m2 = re.search(r'href=\"([^>]*?)\"\s*target=[^>]*?>',str(blk))
                Annual_Report_Link = m2.group(1)
                try:    
                    m3 = re.search(r'<span\s*id=\"ContentPlaceHolder1_lbl_delisted\"\s*[^>]*?>([^>]*?)\([\d]+\)\s*[^>]*?\s*<\/span>',str(postcon))
                    Company_Name = m3.group(1)
                except:
                    m3 = re.search(r'<span\s*id=\"ContentPlaceHolder1_lbl_delisted\"\s*[^>]*?>([^>]*?)\([\d]+\)\s*[^>]*?\s*<\/span>',str(postcon))
                    Company_Name = m3.group(1)
                try:
                    m4 = re.search(r'<span\s*id=\"ContentPlaceHolder1_lbl_delisted\"\s*[^>]*?>[^>]*?\(([\d]+)\)\s*<\/span>',str(postcon))
                    Code = m4.group(1)
                except:
                    m4 = re.search(r'<span\s*id=\"ContentPlaceHolder1_lbl_delisted\"\s*[^>]*?>[^>]*?\(([\d]+)\)\s*[^>]*?\s*<\/span>',str(postcon))
                    Code = m4.group(1)
                
                if Company_Name != '':
                    process_final_status="Success"
                    Detail_result=str(startTime)+'\t'+str(startTime)+'\t'+str(bot_name)+'\t'+str(version)+'\t'+str(systemIp)+'\t'+str(sno)+'\t'+str(sno)+'\t'+str(sno)+'\t'+str(clientid)+'\t'+str(ref_id)+'\t'+str(sno)+'\t'+str(sno)+'\t'+str(target_site_domain)+'\t'+str(input_com_name)+'\t'+str(input_code)+'\t'+str(target_product_url)+'\t'+str(startTime)+'\t'+str(sno)+'\t'+str(input_com_name)+'\t'+str(input_code)+'\t'+str(Company_Name)+'\t'+str(Code)+'\t'+str(Year)+'\t'+str(Annual_Report_Link)+'\t'+str(Comments)+'\t'+str(process_final_status)+'\t'+str(status_scenario)+'\t'+str(target_pid)+'\t'+str(target_parse_timestamp)+'\t'+str(filename)+'\t'+str(target_html_file_path)+'\t'+str(error_code)+'\t'+str(error_message)

                    file = open(Detail_output_file, 'a', encoding='utf-8')
                    file.write(str(Detail_result)+'\n')
                    file.close()
                else:
                    process_final_status="No Result"         
                    Detail_result=str(startTime)+'\t'+str(startTime)+'\t'+str(bot_name)+'\t'+str(version)+'\t'+str(systemIp)+'\t'+str(sno)+'\t'+str(sno)+'\t'+str(sno)+'\t'+str(clientid)+'\t'+str(ref_id)+'\t'+str(sno)+'\t'+str(sno)+'\t'+str(target_site_domain)+'\t'+str(input_com_name)+'\t'+str(input_code)+'\t'+str(target_product_url)+'\t'+str(startTime)+'\t'+str(sno)+'\t'+str(input_com_name)+'\t'+str(input_code)+'\t'+str(Company_Name)+'\t'+str(Code)+'\t'+str(Year)+'\t'+str(Annual_Report_Link)+'\t'+str(Comments)+'\t'+str(process_final_status)+'\t'+str(status_scenario)+'\t'+str(target_pid)+'\t'+str(target_parse_timestamp)+'\t'+str(filename)+'\t'+str(target_html_file_path)+'\t'+str(error_code)+'\t'+str(error_message)

                    file = open(Detail_output_file, 'a', encoding='utf-8')
                    file.write(str(Detail_result)+'\n')
                    file.close()
        else:
        
            process_final_status="No Result"         
            Detail_result=str(startTime)+'\t'+str(startTime)+'\t'+str(bot_name)+'\t'+str(version)+'\t'+str(systemIp)+'\t'+str(sno)+'\t'+str(sno)+'\t'+str(sno)+'\t'+str(clientid)+'\t'+str(ref_id)+'\t'+str(sno)+'\t'+str(sno)+'\t'+str(target_site_domain)+'\t'+str(input_com_name)+'\t'+str(input_code)+'\t'+str(target_product_url)+'\t'+str(startTime)+'\t'+str(sno)+'\t'+str(input_com_name)+'\t'+str(input_code)+'\t'+str(Company_Name)+'\t'+str(Code)+'\t'+str(Year)+'\t'+str(Annual_Report_Link)+'\t'+str(Comments)+'\t'+str(process_final_status)+'\t'+str(status_scenario)+'\t'+str(target_pid)+'\t'+str(target_parse_timestamp)+'\t'+str(filename)+'\t'+str(target_html_file_path)+'\t'+str(error_code)+'\t'+str(error_message)

            file = open(Detail_output_file, 'a', encoding='utf-8')
            file.write(str(Detail_result)+'\n')
            file.close()