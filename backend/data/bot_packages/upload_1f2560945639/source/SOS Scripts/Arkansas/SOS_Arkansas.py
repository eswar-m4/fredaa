import re
import sys
import os
import traceback
import time
import ftplib
import datetime
import shutil
import urllib.parse
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

from bs4 import BeautifulSoup
import requests
from python_anticaptcha import AnticaptchaClient, NoCaptchaTaskProxylessTask
from anticaptchaofficial.recaptchav3proxyless import *
from anticaptchaofficial.recaptchav3enterpriseproxyless import *
from anticaptchaofficial.recaptchav3enterpriseproxyless import *

FTP_Upload_Flag='Yes'
Server_IP1='174.142.250.240'
Server_Username1='perlzuser'
Server_Password1='j2wSPxRi'
ftpOutputPath2='/SD/SP/SOS_2024/2703/Status'


if not os.path.exists('C:/SOS/'):
	os.makedirs('C:/SOS/')
if not os.path.exists('C:/SOS/Cache/'):
	os.makedirs('C:/SOS/Cache/')
if not os.path.exists('C:/SOS/Cache/2703_2/'):
	os.makedirs('C:/SOS/Cache/2703_2/')
	
if not os.path.exists('C:/SOS_URL/'):
	os.makedirs('C:/SOS_URL/')
if not os.path.exists('C:/SOS_URL/Cache/'):
	os.makedirs('C:/SOS_URL/Cache/')
if not os.path.exists('C:/SOS_URL/Cache/2703_2/'):
	os.makedirs('C:/SOS_URL/Cache/2703_2/')
	
def ftpUpload(serverIP,userName,password,ftpPath,fileName):
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
	except:
		pass

	ftp.quit()

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

 
def regex_match(regex,content):
	match=re.search(regex,content,flags=re.I)
	if match:
		return match.group(1)
	return ''

def recaptchaV3Proxyless1(site_key,website_url):
	API_KEY = '14a621479cf19bfa5459bce32e2fefcb'
	solver = recaptchaV3Proxyless()
	# solver = recaptchaV3EnterpriseProxyless()
	# solver.set_verbose(1)
	solver.set_key(API_KEY)
	solver.set_website_url(website_url)
	solver.set_website_key(site_key)
	solver.set_page_action("corpSearch")
	solver.set_min_score(0.9)
	solver.set_soft_id(0)

	g_response = solver.solve_and_return_solution()
	if g_response != 0:
		print("g-response: "+g_response)
		# print("user-agent, use it to post the form: ", solver.get_user_agent())
		# print("respkey, if any: ", solver.get_respkey())
		return g_response
	else:
		print("task finished with error "+solver.error_code)
		return ''


def resolveACReCaptcha(sitekey, pageurl):
	ANTICAPTCHA_KEY = '14a621479cf19bfa5459bce32e2fefcb'
	try:
		# Get Balance
		# balance = AntiCaptchaControl.AntiCaptchaControl(anticaptcha_key = ANTICAPTCHA_KEY).get_balance()["balance"]
		
		client = AnticaptchaClient(ANTICAPTCHA_KEY)
		task = NoCaptchaTaskProxylessTask(pageurl, sitekey)
		job = client.createTask(task)
		print(job.join())
		# captcha = NoCaptchaTaskProxyless.NoCaptchaTaskProxyless(anticaptcha_key =ANTICAPTCHA_KEY ).captcha_handler(websiteURL=pageurl,websiteKey=sitekey)
		if job:
			return job.get_solution_response()
	except Exception as err:
		# Access to DBC API denied, check your credentials and/or balance
		print (str(err))
		return ''

def getSearchPageContent(input_keyword,keyword):
	global sess
	sess = requests.Session()
	proxies={
		"http": "http://d62b7514f9f54a918c0800174005ca86:@proxy.crawlera.com:8011/",
		"https": "http://d62b7514f9f54a918c0800174005ca86:@proxy.crawlera.com:8011/"
	}
	
	headers={"Upgrade-Insecure-Requests":"1","user-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36","accept":"text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7","cookie":"XSRF-TOKEN=eyJpdiI6ImhNWUczMFNnc3I4c3JXRHUyU0FDWUE9PSIsInZhbHVlIjoiUGdDV2ZQVXI0T08ySnROVzh0VG9hQSswU3pSU2F4Zm5JV00xOCtaVjFqaFV5K0JXWndBaXFNKytMaEdwSXFFTnBVcWhrQjN3cW5Gd1lCMXpmTEZBaHoyOEh6THhTeU92RmpZZlo3eXhSbW5zT3luSks3dTlLbTlLZUpRQjVwYkkiLCJtYWMiOiJkZjM2YTUyZjcxN2Q4ZWM4YmViMmY1ZjQ5ODM0M2Y2YmQyM2EwODY1MWM1OWVjMmQ3ZTU1NmE0NTBjMjQ1YzU1IiwidGFnIjoiIn0%3D; sossearch_session=eyJpdiI6ImZWS1hXNEpzblRKM2pjMnpSeE9XZkE9PSIsInZhbHVlIjoiSXRWNXNpNkNNRGhrUFVvd0NHcFdTRmc2aUhiaTBEVXhnNTJVTkJ0aVE4RnA1YTZmb3hwSTdSZ2FtbTRnVWtGc3dvK0s4bHFIQk9OK0l0ZTdXdzBQUDkwSE5rOUdLc3M2cFhzbXQrREk1UnNkUFJqUGJKWTY2Y0dHcXNxSCt4emkiLCJtYWMiOiJhODA4N2RiOThjMmY5Mzc1ZmI1MjEyZjlhZWFlMjUzYjYwM2U4ZWVlNzNkN2JkZmE2MjliY2ZkYmY4ZDFkMjkxIiwidGFnIjoiIn0%3D","X-Crawlera-Cookies": "enable"}
	homeUrl = 'https://www.ark.org/corp-search/index.php/corps'
	obj = sess.get(homeUrl,headers=headers,proxies=proxies, verify=False, timeout=45)
	print('Home_Status:::::',obj.status_code)
	homeContent = obj.text
	soup = BeautifulSoup(obj.text, 'html.parser')
	with open("C:/SOS_URL/Cache/2703_2/Home_Page.html","w") as fh:
		fh.write(str(homeContent))
		
		
	listheaders={"Upgrade-Insecure-Requests":"1","Content-Type":"application/x-www-form-urlencoded","Referer": "https://sos-corp-search.ark.org/index.php/corps","authority":"sos-corp-search.ark.org","user-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}

	list_page_url = f"https://sos-corp-search.ark.org/corps/results?corp_type_id=&corp_name={keyword}&fict_name=&agent_search=&agent_city=&agent_state=&filing_number="
	print("list_page_url ::", list_page_url)

	listobj = sess.get(list_page_url,headers=listheaders,proxies=proxies, verify=False, timeout=45)
	print('List_Status:::::',listobj.status_code)
	soup=BeautifulSoup(listobj.text,'html.parser')
	try:
		page_no = regex_match( r'<caption>\s*Records\s*Returned\s*\:\s*([^<]*?)\s*<\/caption>',obj.text)
		print("pages ::", page_no)
		return listobj, page_no
	except Exception as e:
		print("ERROR:", e)
		return None, None
		
def getDetailPageCache(content,totalPages,keyword):
	try:
		soup=BeautifulSoup(content,'html.parser')
		content = re.sub("\&quot\;",'"',content)
		wireid=regex_match('<div\s*wire\:id=\"([^\"]*?)\"\s*wire\:initial\-data=\"[^>]*?corp-detail-modal[^>]*?\">',content)
		wireinitial=regex_match('<div\s*wire\:id=\"[^\"]*?\"\s*wire\:initial\-data=\"([^>]*?corp-detail-modal[^>]*?)\">',content)
		csrf_token=regex_match('<meta\s*name=\"csrf\-token\"\s*content=\"([^\"]*?)\">',content)
		wireinitial = re.sub("\"effects\"\:\{\"listeners\"\:\[\"details\"\]\}\,",'',str(wireinitial))
		wireinitial = re.sub("\}\}$",'}',str(wireinitial))
		# print("wireinitial :"+wireinitial)
		wireinitial =wireinitial + ',"updates":[{"type":"fireEvent","payload":{"id":"lr32","event":"details","params":["'
		SubmitpageId=soup.find('table',attrs={'id':True}).find('tbody').find_all('tr')
		# print("wireinitial :"+wireinitial)
		# page_ids = []
		# for row in SubmitpageId:
			# td_tag = row.find('td', {'id': True})  # Find the <td> with an 'id' attribute
			# if td_tag:
				# page_ids.append(td_tag['id'])  # Append the id value to the list

		# Print all extracted page IDs
		# print("Extracted Page IDs:", page_ids)
		proxies={
		"http": "http://d62b7514f9f54a918c0800174005ca86:@proxy.crawlera.com:8011/",
		"https": "http://d62b7514f9f54a918c0800174005ca86:@proxy.crawlera.com:8011/"
		}
		
		headers = {"Referer":"https://sos-corp-search.ark.org/corps/results?corp_type_id=&corp_name=AA&fict_name=&agent_search=&agent_city=&agent_state=&filing_number=","User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36","authority":"sos-corp-search.ark.org","Accept":"*/*"}
		# print ("SubmitpageId ::"+ str(SubmitpageId))
		# print ("cookie ::"+ cookie)
		Count=0
		for Block in SubmitpageId:
			id=Block.find('td').get('id')
			print('BusinessID  ::  '+str(id))
			Count=int(Count)+1
			if not os.path.isfile("Cache/"+id+".html"):
				# captcha = recaptchaV3Proxyless1('6Ld5_hgiAAAAAHHJttFsajLG_bH-mbdjH3BdVUQV','https://www.ark.org/corp-search/index.php/corps')
				# while captcha=='':
					# print("Empty Captcha Response: Going to Sleep for 60 sec and retry")
					# time.sleep(60)
					# captcha = recaptchaV3Proxyless1('6Ld5_hgiAAAAAHHJttFsajLG_bH-mbdjH3BdVUQV','https://www.ark.org/corp-search/index.php/corps')
				# postParam = str(wireinitial) + str(id) +'","'+ captcha +'"]}}]}'
				# print("POSTPARAM "+ postParam)
				detail_page_link = f"https://sos-corp-search.ark.org/corps/details?id={id}"
				obj = sess.get(detail_page_link,headers=headers,proxies=proxies,verify=False,timeout=45)
				print('Detail_Status:::::',obj.status_code)
				content = obj.text
				with open("C:/SOS/Cache/2703_2/DetailPage_"+id+"_"+str(Count)+".html","wb") as fh:
					fh.write(obj.content)
				
				count1 = 0
				while count1 < 2:
					con_obj = re.search('(An\s*error\s*occurred\s*with\s*your\s*request|\"\s*The\s*specified\s*URL\s*cannot\s*be\s*found\s*\")',content,re.I|re.M)
					if con_obj:
						print('Script goes to reping')
						time.sleep(10)
						captcha = recaptchaV3Proxyless1('6Ld5_hgiAAAAAHHJttFsajLG_bH-mbdjH3BdVUQV','https://www.ark.org/corp-search/index.php/corps')
						while captcha=='':
							print("Empty Captcha Response: Going to Sleep for 60 sec and retry")
							time.sleep(60)
							captcha = recaptchaV3Proxyless1('6Ld5_hgiAAAAAHHJttFsajLG_bH-mbdjH3BdVUQV','https://www.ark.org/corp-search/index.php/corps')
						postParam = str(wireinitial) + str(id) +'","'+ captcha +'"]}}]}'
						# print("POSTPARAM "+ postParam)
						obj = sess.post('https://www.ark.org/corp-search/index.php/livewire/message/corp-detail-modal',data=postParam,headers=headers)
						print('Detail_Status:::::',obj.status_code)
						content = obj.text
						with open("C:/SOS/Cache/2703_2/DetailPage_"+keyword+"_"+str(Count)+".html","wb") as fh:
							fh.write(obj.content)
					count1=count1+1
				# try:
					# content = re.sub("<script[^>]*?>[\w\W]+?<\/script>",'',str(content))
				# except:
					# content = content.encode("utf-8")
					# content = re.sub("<script[^>]*?>[\w\W]+?<\/script>",'',str(content))
				# content = re.sub("\s\s+",' ',str(content))
				# try:
				# with open("Cache/"+keyword+"_"+str(Count)+".html","wb") as fh:
					# fh.write(obj.content)
				# except:
					# with open("Cache/"+id+".html","w") as fh:
						# fh.write(content)
	except:
		print(traceback.format_exc())
		print("ISSUE")
		sys.exit(1)
		getDetailPageCache(content,requestVerification,totalPages,cookie)

def getPageContent(page,cookie,requestVerification,noTry):
	try:
		headers = {"Cookie": cookie, "Host":"bsd.sos.in.gov", "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "Referer": "https://bsd.sos.in.gov/publicbusinesssearch", "X-Requested-With": "XMLHttpRequest", "Connection": "keep-alive","ADRUM":"isAjax:true"}
		noTry+=1
		obj = sess.post("https://bsd.sos.in.gov/publicbusinesssearch",data='undefined=&sortby=&stype=a&pidx='+str(page),headers = headers)
		# obj = sess.post("https://portal.sos.state.nm.us/BFS/online/CorporationBusinessSearch/PartnershipBusinessList",data='undefined=&sortby=&stype=a&pidx='+str(page),headers = headers)
		with open("Cache/"+keyword+"/"+keyword+"_"+str(page)+".html",'wb') as fh:
			fh.write(obj.content)
		content = obj.text
		return content
	except:
		print(traceback.format_exc())
		if noTry<=5:
			obj,cookie,requestVerification = getSearchPageContent(keyword)
			return getPageContent(page,cookie,requestVerification,noTry)
		else:
			return ''


if __name__=="__main__":
	systemIp=ipaddress()
	startID = sys.argv[1]
	endID = sys.argv[2]
	startID.strip()
	endID.strip()
	
	filename1 = "Input.txt"
	f = open(filename1, "r", encoding="utf-8")
	contents = f.readlines()

	for i in range(int(startID), int(endID)+1):

		line = contents[i].strip()

		if "CO_Ent_Nbr" in line:
			continue

		parts = line.split('\t')

		if len(parts) < 2:
			print("Skipping bad line:", line)
			continue

		company_id = parts[0].strip()
		input_keyword = parts[1].strip()

		print(company_id, input_keyword)

		keyword = urllib.parse.quote_plus(input_keyword)
		# keyword = input_keyword
		print("keyword", keyword)

		sess = requests.Session()

		result = getSearchPageContent(input_keyword,keyword)

		if not result:
			print("Failed:", input_keyword)
			continue

		obj, pages = result

		searchContent = obj.text

		with open("C:/SOS_URL/Cache/2703_2/ListPage_" + company_id + ".html", "wb") as fh:
			fh.write(obj.content)

		print("pages  ::  " + str(pages))

		getDetailPageCache(searchContent,pages,keyword)
	
	if FTP_Upload_Flag == 'Yes':
		com_file=str(systemIp)+"_Completed.txt" 
		com_result='Completed'
		file = open(com_file, 'a', encoding='utf-8')
		file.write(str(com_result)+'\n')
		file.close()
		ftpUpload(Server_IP1,Server_Username1,Server_Password1,ftpOutputPath2,com_file)