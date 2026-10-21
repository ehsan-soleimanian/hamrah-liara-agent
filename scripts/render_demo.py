"""Render an honest 300-second, silent walkthrough from CUA browser captures.

Usage: python scripts/render_demo.py [--ffmpeg PATH] [--font PATH]
Requires imageio-ffmpeg when --ffmpeg is omitted. No browser automation occurs here.
"""
from pathlib import Path
import argparse
import shutil
import subprocess
import json

ROOT = Path(__file__).resolve().parent.parent
SCENES = [
    ('01-overview',15,'همراه؛ با خیال راحت، رشد کنید','مرور تصویری MVP محلی و بی‌صدا؛ رابط فارسی، راست‌به‌چپ و واکنش‌گرا'),
    ('02-memory-chat',15,'گفتگو با حافظهٔ پایدار','پیام‌ها و تصمیم‌ها در SQLite می‌مانند؛ پاسخ‌های این حالت نمایشی‌اند'),
    ('03-setup',10,'شروع از نیاز کسب‌وکار','کاربر از فروشگاه، سایت معرفی یا وب‌اپ می‌گوید؛ دانش زیرساخت لازم نیست'),
    ('04-recommendation',12,'پیشنهاد روشن، بدون هزینهٔ ساختگی','زیرساخت ضروری از توسعه‌های بعدی جداست؛ خرید و ساخت برنامهٔ جدید دستی است'),
    ('05-deploy-ready',10,'آمادهٔ انتشار با تصمیم شما','سورس نمونه آماده است؛ در اتصال واقعی، مقصد باید صریحاً مجوز تغییر داشته باشد'),
    ('06-deploy-approval',12,'کنترل در دست کاربر','مقصد، اثر، هزینه و مهلت تأیید مشخص‌اند؛ در این دمو سورس به ابر ارسال نمی‌شود'),
    ('07-releases',8,'تاریخچهٔ انتشار قابل پیگیری','انتشارهای این صفحه نمایشی‌اند؛ اتصال واقعی از API لیارا استفاده می‌کند'),
    ('08-shop-healthy',12,'یک کسب‌وکار آزمایشی واقعی','سفارش در SQLite محلی ثبت می‌شود؛ این پرداخت واقعی نیست'),
    ('09-demo-fault',12,'اختلال کنترل‌شده ایجاد می‌کنیم','فقط فروشگاه محلی درگیر می‌شود؛ اتصال‌های مشغول دیتابیس شبیه‌سازی می‌شوند'),
    ('10-shop-failed',10,'اثر اختلال بر کسب‌وکار','مسیر ثبت سفارش واقعاً خطا می‌دهد؛ صرف نمایش یک هشدار در داشبورد نیست'),
    ('11-proactive-detection',16,'کشف مستقل از گفتگو','Worker پس از سه بررسی ناموفق، بدون پیام کاربر یک رخداد می‌سازد'),
    ('12-investigation',20,'تشخیص از روی شواهد','لاگ، شکست بررسی‌ها و علت احتمالی همراه با زمان ثبت می‌شوند'),
    ('13-restart-approval',18,'برای تغییر حساس، تأیید لازم است','ایجنت نمی‌تواند خودش تأیید کند؛ درخواست مشخص، منقضی‌شونده و یک‌بارمصرف است'),
    ('14-verified-recovery',20,'معیار موفقیت: نتیجهٔ کسب‌وکار','دو بررسی موفق متوالی سلامت و ثبت سفارش؛ سپس رخداد برطرف‌شده اعلام می‌شود'),
    ('19-failed-verification',18,'اگر اصلاح شکست بخورد چه می‌شود؟','در خرابی پایدار، ری‌استارت کافی نیست؛ همراه شکست را ثبت می‌کند و موفقیت نمی‌سازد'),
    ('20-external-recovery',12,'پیگیری پس از اصلاح بیرونی','بعد از رفع دستی مشکل هم سلامت و مسیر سفارش دوباره بررسی می‌شوند'),
    ('15-backups',14,'یک راه برگشت برای اطلاعات','پشتیبان محلی واقعی است؛ پیش از بازیابی نسخهٔ ایمنی ساخته می‌شود'),
    ('16-growth',12,'فرصت‌های رشد، با توضیح محدودیت','کش و ایمیل پیشنهادند؛ پرداخت، خرید سرویس و اصلاح کد در این MVP متصل نیست'),
    ('17-audit-memory',15,'هیچ تصمیمی گم نمی‌شود','گفتگو، شواهد، تأیید و نتیجه؛ گزارش قابل دریافت و زنجیرهٔ هش قابل بررسی است'),
    ('18-connections',13,'کلیدها فقط سمت سرور','Liara API و Cursor SDK محلی آمادهٔ پیکربندی‌اند؛ اتصال زنده بدون کلید تأیید نشده است'),
    ('22-mobile',10,'همراه روی صفحهٔ کوچک هم کنار شماست','منوی موبایل و تأییدهای قابل‌فهم؛ بررسی در عرض‌های ۳۹۰، ۷۶۸ و ۱۴۴۰ پیکسل'),
    ('21-overview-final',16,'کنشگر، مسئولیت‌پذیر، قابل‌کنترل','شما محصولتان را بسازید؛ همراه مراقبت می‌کند و نتیجه را پیگیری می‌کند'),
]

def stamp(seconds):
    seconds = int(seconds)
    return f'{seconds//3600}:{seconds%3600//60:02d}:{seconds%60:02d}.00'

def escape(text):
    return text.replace('\\','\\\\').replace('{','').replace('}','').replace('\n','\\N')

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--ffmpeg')
    parser.add_argument('--font', default='C:/Windows/Fonts/Vazir Regular.ttf')
    args=parser.parse_args()
    if args.ffmpeg:
        ffmpeg=args.ffmpeg
    else:
        import imageio_ffmpeg
        ffmpeg=imageio_ffmpeg.get_ffmpeg_exe()
    frames=ROOT/'artifacts/demo-frames'
    out=ROOT/'docs/demo'
    out.mkdir(parents=True,exist_ok=True)
    fonts=ROOT/'artifacts/video-fonts'
    fonts.mkdir(parents=True,exist_ok=True)
    if Path(args.font).is_file():
        shutil.copy2(args.font,fonts/'Vazir-Regular.ttf')
    normalized=ROOT/'artifacts/demo-normalized'
    normalized.mkdir(parents=True,exist_ok=True)
    concat=[]
    ass=['[Script Info]','ScriptType: v4.00+','PlayResX: 1920','PlayResY: 1080','WrapStyle: 0','',
         '[V4+ Styles]',
         'Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding',
         'Style: Title,Vazir,32,&H00B7E4C4,&H00B7E4C4,&H000C170F,&H000C170F,-1,0,0,0,100,100,0,0,1,1,0,2,100,100,92,1',
         'Style: Body,Vazir,26,&H00E2ECE6,&H00E2ECE6,&H000C170F,&H000C170F,0,0,0,0,100,100,0,0,1,1,0,2,100,100,38,1','',
         '[Events]','Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text']
    elapsed=0
    manifest=[]
    for index,(name,duration,title,body) in enumerate(SCENES,1):
        file=frames/(name+'.png')
        if not file.is_file():
            raise FileNotFoundError(file)
        normalized_file=normalized/(name+'.png')
        subprocess.run([ffmpeg,'-y','-hide_banner','-loglevel','error','-i',str(file),'-vf','scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x101913,setsar=1','-frames:v','1','-pix_fmt','rgb24',str(normalized_file)],check=True)
        concat.extend([f"file '{normalized_file.as_posix()}'",f'duration {duration}'])
        start,end=stamp(elapsed),stamp(elapsed+duration)
        ass.append(f'Dialogue: 1,{start},{end},Title,,0,0,0,,{escape(title)}')
        ass.append(f'Dialogue: 1,{start},{end},Body,,0,0,0,,{escape(body)}')
        manifest.append({'scene':index,'image':name,'start':elapsed,'duration':duration,'title':title,'caption':body})
        elapsed+=duration
    assert elapsed==300,elapsed
    concat.append(f"file '{(normalized/(SCENES[-1][0]+'.png')).as_posix()}'")
    (ROOT/'artifacts/demo.concat').write_text('\n'.join(concat),encoding='utf-8')
    (ROOT/'artifacts/demo.ass').write_text('\n'.join(ass),encoding='utf-8-sig')
    (out/'scenes.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    filters="scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x101913,setsar=1,fps=24,drawbox=x=0:y=900:w=iw:h=180:color=0x0e1914@0.96:t=fill,ass=artifacts/demo.ass:fontsdir=artifacts/video-fonts"
    subprocess.run([ffmpeg,'-y','-hide_banner','-loglevel','warning','-f','concat','-safe','0','-i',str(ROOT/'artifacts/demo.concat'),'-vf',filters,'-t','300','-an','-c:v','libx264','-preset','veryfast','-crf','22','-pix_fmt','yuv420p','-movflags','+faststart',str(out/'hamrah-demo.mp4')],cwd=ROOT,check=True)
    print(json.dumps({'path':str(out/'hamrah-demo.mp4'),'duration':elapsed,'bytes':(out/'hamrah-demo.mp4').stat().st_size}))

if __name__=='__main__':
    main()
