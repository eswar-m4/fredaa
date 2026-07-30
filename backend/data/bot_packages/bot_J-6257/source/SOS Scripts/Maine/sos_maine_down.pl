use strict;
use LWP::UserAgent;
use URI::URL;
use HTTP::Cookies;
use DateTime;
use LWP::Simple;
use HTML::Entities;
use Encode;
use Cwd;
# require "api.pl";
use IO::Socket::SSL;
use AntiCaptcha;
use Net::FTP::File;
use File::Copy;
use MIME::Base64 qw(encode_base64);
IO::Socket::SSL::set_defaults(SSL_cipher_list => 'ALL:!3DES:!DES:!ADH:!SRP:!AESGCM:!SHA256:!SHA384');

open(FH,">C:/SD/sos_nebraska.txt");
print FH "$$\n";
close FH;
my $process_ID=$$;
#############USER AGENT CREATION#####################
my $ua=LWP::UserAgent->new();
my $ua1=LWP::UserAgent->new();

$ua1->agent("Mozilla/5.0 (Windows NT 6.1; Win64; x64; rv:44.0) Gecko/20100101 Firefox/44.0");
$ua->agent("Mozilla/5.0 (Windows NT 6.1; Win64; x64; rv:44.0) Gecko/20100101 Firefox/44.0");
$ua->ssl_opts('verify_hostname' => 0);
my $process='SOS';
#############COOKIES CREATION#####################
my $cookie=HTTP::Cookies->new(file=>$0."cookie.txt",autosave=>1);
$ua->cookie_jar($cookie);
# $SIG{__DIE__} = sub {\&Die_Handling(@_);};
my $Start_ID=$ARGV[0];
my $End_ID=$ARGV[1];
# my $Folder=$ARGV[2];

my $start=DateTime->now();
open (FH,">Log_file.txt");
print FH  "\nProgram start $start\n";	
close FH;
&foldercreation();
my $wac = AntiCaptcha->new(
    # clientKey => '16cfead385efdd1058b4e6e45d693050'
    # clientKey => 'c547036f9c9e9f8498507bd7088599a8'
    # clientKey => '81440d4c19c52549891691f76d508387'
    clientKey => '800f4e0476f0b772a157d1d061caeec4'
	# 800f4e0476f0b772a157d1d061caeec4
);
my $value1='';
 if(-e 'C:/SD/ip.txt')
{
	open(FH,"<C:/SD/ip.txt");
	$value1=<FH>;
	close FH;
	print "Got Server IP from File  ::  $value1\n";
}
else
{
	my $CNT =0;
	my $url="http://checkip.dyndns.org/";
	GetIP:
	
	# my %headers=();
	# my $origin_content=&Get_Content($url,'GET','',\%headers);
	
	# if($origin_content =~m/<body>\s*Current\s*IP\s*Address\:\s*([\d\.]+)<\/body>/is)
	# {
		# $value1=$1;
		# open(FH,">C:/SD/ip.txt");
		# print FH $value1;
		# close FH;
		# print "Got Server IP from URL  ::  $value1\n";
	# }
	if($value1 eq '')
	{
		if($CNT<=3)
		{
			goto GetIP;
		}
		$CNT++;
	}	
}
my $today=DateTime->now()->ymd('-');
my $ip_address=$value1;
my $res = $wac->getBalance or die $wac->errstr;
print "$res->{balance}\n";
my $Process='SOS';
my $Link_ID='2731_new_1';
my $Unique_ID='2731';
$value1="$value1"."_".int(rand(1000));
my $process1="$Process"."_$value1"."_OP";
(my $cu_date=DateTime->now())=~s/([^>]+?T\d+)\:.+$/$1/igs;
&foldercreation();
my $output_file=$process1."_$Link_ID"."_UID_$Unique_ID"."_$Start_ID"."_$End_ID"."_$cu_date.txt";
$output_file=~s/_{2,}/_/igs;
my $prev_output_file=$output_file;
my $cap_file="captcha_log"."_$Link_ID"."_UID_$Unique_ID"."_$Start_ID"."_$End_ID"."_$cu_date.txt";
$cap_file=~s/_{2,}/_/igs;

my $ftpserver='174.142.250.240';
my $ftpuser='perlzuser';
my $ftppass='Mc*&6~#uVh4agZKE';
my $ftppath='/IG_SOS/Scraped_Output/URL_Dump/2731_ME/Dump/';

my $ftpserver_log='184.107.72.173';
my $ftpuser_log='perlzuser';
my $ftppass_log='j2wSPxRi';
my $ftppath_log='/sd/Captcha_log/';

open (FH, ">$output_file");
print FH "Date_of_prod\tUID\tURL\tBusiness_id\tDetail_Url\tBusiness_Name\tResult_Count\tIp_Address\tcache_page\tList_url\tInput_keyword\tStatus\tList_Block\n";
close FH; 

open(FH,"<Input.txt") or die "\n There is no Master_Index_Pending INPUT File in this Location $!\n";
my @inputs=<FH>;
close FH;my $Proxy;
for (my $J=$Start_ID; $J<=$End_ID; $J++)
{
	my @input=split('\t',$inputs[$J]);
	my $auto=$input[0];
	my $buid=$input[1];
	my $detID=$input[2];
	chomp($auto);	
	chomp($buid);	
	chomp($detID);	
	
	my $con=&getcont($detID,'GET','','','');
	$con=~s/\\u(\w{4})/&#x$1;/igs;
	$con=~s/&amp;/&/igs;
	$con=~s/&nbsp;/ /igs;
	$con=decode_entities($con);
	
	my $cache="Detailpage_new_$auto.html";
	open(FH,">C:/$Process/Cache/$Link_ID/$cache");
	print FH $con;
	close FH;

	if($con=~m/>List\s*of\s*Filings<\/font><\/td>[\w\W]*?<a\s*target=\"[^>]*?\" \s*href=\"([\w\W]*?)\">View\s*list\s*of\s*filings<\/a><\/font><\/td>/is)
	{
		my $trmination_id=$1;
		my $termination=&getcont("https://apps3.web.maine.gov$trmination_id",'GET','','','');
		my $term_cache="Terminationpage_new_$auto.html";
		open(FH,">C:/$Process/Cache/$Link_ID/$term_cache");
		print FH $termination;
		close FH;	
	}
}

# &ftpupload($ftpserver,$ftpuser,$ftppass,$ftppath,$output_file);
# move($output_file,"C:/$Process/Output/$output_file");
# &ftpupload($ftpserver_log,$ftpuser_log,$ftppass_log,$ftppath_log,$cap_file);

	
sub anticaptcha_api()
{
	my $Harvested_Source_URL=shift;
	# my $para='{"clientKey":"8516bb34afaee3397e3829c2f4b71d96","task":{"type":"NoCaptchaTaskProxyless","websiteURL":"'.$Harvested_Source_URL.'",
	# my $para='{"clientKey":"800f4e0476f0b772a157d1d061caeec4","task":{"type":"RecaptchaV3TaskProxyless","websiteURL":"'.$Harvested_Source_URL.'","websiteKey":"6Le_D7kcAAAAAIMAAM22oSjxhs0Uz7R-affxnyuR","minScore": 0.3}}';
	# my $para='{"clientKey":"16cfead385efdd1058b4e6e45d693050","task":{"type":"NoCaptchaTaskProxyless","websiteURL":"'.$Harvested_Source_URL.'",
            # "websiteKey":"6LcmsP4SAAAAAJeHxpx9VA7CeZq_9gf74M8tJVra"}}';
	# my $para='{"clientKey":"c547036f9c9e9f8498507bd7088599a8","task":{"type":"NoCaptchaTaskProxyless","websiteURL":"'.$Harvested_Source_URL.'",
            # "websiteKey":"6LcmsP4SAAAAAJeHxpx9VA7CeZq_9gf74M8tJVra"}}';
	my $para='{"clientKey":"800f4e0476f0b772a157d1d061caeec4","task":{"type":"NoCaptchaTaskProxyless","websiteURL":"'.$Harvested_Source_URL.'",
            "websiteKey":"6Le_D7kcAAAAAIMAAM22oSjxhs0Uz7R-affxnyuR"}}';
		my %headers=();
	my $reping_count=0;
	reping:
	my ($create_task_res,$create_code)=anticaptcha_api_content("https://api.anti-captcha.com/createTask",'POST',$para,\%headers);
	print "create_task_res::$create_task_res\n";
	print "create_code::$create_code\n";	
	sleep(20);
	my $time_sleep=20;
	if($create_task_res=~m/\{"errorId":0,"taskId":(\d+)\}/is)
	{
		my $task_id=$1;
		my $solve_count=1;
		if($task_id ne '')
		{
			# my $para1='{"clientKey":"16cfead385efdd1058b4e6e45d693050","taskId":'.$task_id.'}';
			# my $para1='{"clientKey":"c547036f9c9e9f8498507bd7088599a8","taskId":'.$task_id.'}';
			my $para1='{"clientKey":"800f4e0476f0b772a157d1d061caeec4","taskId":'.$task_id.'}';
			recheck:
			my ($task_res,$task_code)=anticaptcha_api_content("https://api.anti-captcha.com/getTaskResult",'POST',$para1,\%headers);
			print "task_res::$task_res";
			print "task_code::$task_code\n";
			# if(($task_res=~m/"status":"processing"/is)&&($solve_count<=4))
			# if(($task_res=~m/"status":"processing"/is)&&($solve_count<=2))
			if($task_res=~m/"status":"processing"/is)
			{
				sleep(10);
				$time_sleep=$time_sleep+10;
				$solve_count++;
				goto recheck;
			}
			else{
				if($task_res=~m/"status":"ready","solution":\{"gRecaptchaResponse":"([^\"]*?)\"/is)
				{
					my $key=$1;
					open fh,">>$cap_file";
					print fh "Anticaptcha\t800f4e0476f0b772a157d1d061caeec4\tSOS\t$Harvested_Source_URL\t$create_task_res\t$create_code\t$task_id\t$task_res\t$task_code\t$key\tsuccess\t$solve_count\t$time_sleep\t$ip_address\n";
					close fh;
					return($key);
				}
				else{
					open fh,">>$cap_file";
					print fh "Anticaptcha\t800f4e0476f0b772a157d1d061caeec4\tSOS\t$Harvested_Source_URL\t$create_task_res\t$create_code\t$task_id\t$task_res\t$task_code\t\tFailure\t$solve_count\t$time_sleep\t$ip_address\n";
					close fh;
						if ($reping_count<=2)
						{
							$reping_count++;
							goto reping;
						}
						else
						{
							exit;
						}
					}
			}		
			
		}
		else{
		open fh,">>$cap_file";
		print fh "Anticaptcha\t800f4e0476f0b772a157d1d061caeec4\tSOS\t$Harvested_Source_URL\t$create_task_res\t$create_code\t$task_id\t\t\t\ttaskid empty\t$solve_count\t$time_sleep\t$ip_address\n";
		close fh;
		exit;
		}		
	
	}

}

sub anticaptcha_api_content($$$$)
{	
	my $mainurl=shift;
	my $method=shift;
	my $parameter=shift;
	my $headers=shift;
	my $PageDetail=shift;		
	my $FName=shift;
	# my $Alpha=shift;	
	
	my %headers=%$headers;
	
	$mainurl=~s/\&amp\;/\&/igs;
	my $total_debug=0;
	my $debug=0;
	my $count1=0;
	home:
	my $req=HTTP::Request->new($method=>"$mainurl");
	
	if($method eq 'POST')
	{		
		$req->content("$parameter");	
	}	
	foreach my $key(keys%headers)
	{
		if($headers{$key} ne '')
		{
			$req->header("$key"=> "$headers{$key}");		
		}
	}
	
	my $res=$ua1->request($req);	
	my $code=$res->code;
	my $CType=$res->header('Content-Disposition');
	my $data= $res->request->uri ;
	
	open (fh,">>Log_file.txt");
	print fh "$mainurl\t$code\n";
	# print fh "$Alpha\t$mainurl\t$code\n";
	close fh;
	
	my $ST_Desc;
	$ST_Desc = "Success" if($code =~m/20/is);
	$ST_Desc = "Redirect" if($code =~m/30/is);
	$ST_Desc = "Incorrect URL" if($code =~m/40/is);
	$ST_Desc = "Net Failure" if($code =~m/50/is);
	my $cont=$res->content;		
	return($cont,$code);
	
}

sub foldercreation()
{
	mkdir "C:/$Process/",0777 unless(-d "C:/$Process");
	mkdir "C:/$Process/Cache/",0777 unless(-d "C:/$Process/Cache/");
	mkdir "C:/$Process/Cache/2731_new_1/",0777 unless(-d "C:/$Process/Cache/2731_new_1/");
}
sub getcont()
{
    my($url,$method,$cont,$ref,$Host,$COOkie)=@_;
	my $iterr=0;
	# sleep(4 + int(rand(3)));
	
    # print "URL :: $url\n";
	my $request=HTTP::Request->new("$method"=>$url);
	
	# $ua->proxy(['http','https'], "http://$Proxy:60000");
	# $request->proxy_authorization_basic('mobius', '1v9UbX0L3o');

	Home:
    if($method eq 'POST')
    {
        $request->content($cont);
		$request->header("Accept"=>"text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7");
		$request->header("Content-Type"=>"application/x-www-form-urlencoded");
		# $request->header("Cookie"=>"6282ffe38d106aabc599523f5243c2aa; SessionID=6282ffe38d106aabc599523f5243c2aa;");
	    
    }
	$request->header("Referer"=>"https://apps1.web.maine.gov/nei-sos-icrs/ICRS?badsearch=1&MainPage=x");
	$request->header("Host"=>"apps1.web.maine.gov");
	my $res=$ua->request($request);
	# $cookie->extract_cookies($res);
	# $cookie->save;
	# $cookie->add_cookie_header($request);
	my $code=$res->code;
	my $code1=$res->status_line;
	# my $SetCookie=$res->Set_Cookie();
	print "code :: $code :: \n";
    if($code==200)
    {
		
        my $content=$res->content();
		return $content;
    }
    elsif($code=~m/50/is)
    {
		if($iterr==3)
		{
			return;
		}
        print"\n Net Failure";
        sleep(30);
		$iterr++;
        # goto Home;
		
		
    }
    elsif($code=~m/30/is)
    {
       
		my $loc=$res->header("Location");
        print "\nLocation: $loc\n";
		
		my $LOC= "https://ecorp.azcc.gov".$loc;
		# print "$LOC\n";<stdin>;
		# goto Home;
		my $request=HTTP::Request->new("GET"=>$LOC);
		$request->header("Host"=>"ecorp.azcc.gov");
		my $res=$ua->request($request);
		my $content=$res->content();
		# open(OUT1,">Caphcha.html");
	# print OUT1 "$content\n";
	# close OUT1;
		return $content;
		
    }
    elsif($code=~m/40/is)
    {
		my $content=$res->content();
		return $content;
        print "\n URL ERROR";
    }
}
sub clean()
{
	my $value=shift;
	chomp($value);	
	# $value=~s/[^[:ascii:]]//igs;
	$value = decode_utf8($value);
	$value=decode_entities($value);
	$value=~s/\n/ /igs;
	$value=~s/<[^>]*?>/ /igs;
	$value=~s/\t/ /igs;
	$value=~s/\|/ /igs;	
	$value=~s/\&amp\;/&/igs;
	$value=~s/\&nbsp\;/ /igs;
	$value=~s/\&#39\;/'/igs;
	$value=~s/\&quot\;/"/igs;
	$value=~s/\.$//igs;
	$value=~s/^\,\s*//igs;
	$value=~s/\,\s*$//igs;
	$value=~s/\s+/ /igs;
	$value=~s/^\s+|\s+$//igs;
	return ($value);
}

sub ftpupload($$$$$)
{
	my $host=shift;
	my $user_name=shift;
	my $password=shift;
	my $ftp_path=shift;
	my $file_name=shift;
	my $count=0;
	CFTP:
	my $ftp;
	eval{
		$ftp = Net::FTP->new("$host", Debug => 0);
	
	};
	if($@)
	{
		print "$@\n";
		open(FHcaptcha,">>Log_file.txt");			
		print FHcaptcha "FTP upload conn error :: $@ \n";
		close FHcaptcha;	
		
		# sleep(180);
		goto CFTP;           
	}
	else
	{
		my @fil;
		eval
		{
			if($ftp->login("$user_name","$password"))
			{
				
				if($ftp->cwd("$ftp_path"))
				{
					$ftp->binary;
					eval
					{
						$ftp->put("$file_name", "$file_name");
					};
					if($@)
					{
						$count++;
						if($count<=3)
						{
							# sleep(60);
							open(FHcaptcha,">>Log_file.txt");			
							print FHcaptcha "FTP upload conn put error $file_name   $@ count $count \n";
							close FHcaptcha;
							goto CFTP;   
							
						}  	
						else{
							open(FHcaptcha,">>Log_file.txt");			
							print FHcaptcha "FTP upload conn put error $file_name   $@ count $count  excced\n";
							close FHcaptcha;
						}
					}
				}
				else
				{
					$count++;
					if($count<=3)
					{
						sleep(60);
						open(FHcaptcha,">>Log_file.txt");			
						print FHcaptcha "FTP upload conn cwd error $file_name  count $count ::  \n";
						close FHcaptcha;
						goto CFTP; 					
					}
					else
					{
						open(FHcaptcha,">>Log_file.txt");			
						print FHcaptcha "FTP upload conn cwd error $file_name  count $count exceed::  \n";
						close FHcaptcha;					
					
					}
				}
			}
			else
			{
				$count++;
				if($count<=3)
				{
					# sleep(60);
					open(FHcaptcha,">>Log_file.txt");			
					print FHcaptcha "FTP upload conn login else error $file_name  count $count:: $@ \n";
					close FHcaptcha;
					goto CFTP;   
					
				}
				else
				{
					open(FHcaptcha,">>Log_file.txt");			
					print FHcaptcha "FTP upload conn login else error $file_name :: $@ $count exceed: \n";
					close FHcaptcha;
				}
			}
		};
		if($@)
		{
			open(FHcaptcha,">>Log_file.txt");			
			print FHcaptcha "FTP upload conn eval login error $file_name :: $@ \n";
			close FHcaptcha;	
			$count++;
			if($count<=3)
			{
				# sleep(60);
				open(FHcaptcha,">>Log_file.txt");			
				print FHcaptcha "FTP upload conn cwd error $file_name  count $count::  \n";
				close FHcaptcha;
				goto CFTP; 					
			}
			else
			{
				open(FHcaptcha,">>Log_file.txt");			
				print FHcaptcha "FTP upload conn login else error $file_name :: $@ $count exceed: \n";
				close FHcaptcha;
			}
		
		}
		
	}

}

my $end=DateTime->now();
open(FHcaptcha,">>Log_file.txt");			
print FHcaptcha "end $end\n";
close FHcaptcha;

open (FH,">>Log_file.txt");
print FH  "\nProgram Completed successfully\n";	
close FH;