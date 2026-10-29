"""Generate an original, silent, educational MP4 for the WMGJ pre-registration portal.

Production of this public instruction video requires Pillow and imageio-ffmpeg.
Only original visual/text content, no patient images or copyrighted music.
"""
from __future__ import annotations
import os, subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from imageio_ffmpeg import get_ffmpeg_exe

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/"hosting"/"aurora-nexus"/"arquivos"/"wmgj"
OUT.mkdir(parents=True,exist_ok=True)
TEMP=Path(os.getenv("TEMP") or os.getenv("TMP") or str(OUT))/"aurora-credmed-video-build"
TEMP.mkdir(parents=True,exist_ok=True)
NAVY=(7,59,76);GOLD=(197,154,69);CREAM=(247,243,236);PALE=(196,224,217);MUTED=(205,220,217)
REGULAR=r"C:\Windows\Fonts\arial.ttf"
BOLD=r"C:\Windows\Fonts\arialbd.ttf"
SERIF=r"C:\Windows\Fonts\georgia.ttf"
def font(path,size):
    try: return ImageFont.truetype(path,size)
    except OSError: return ImageFont.load_default()

def slide(index,headline,lines):
    im=Image.new("RGB",(1280,720),NAVY)
    draw=ImageDraw.Draw(im)
    for y in range(720):
        fraction=y/720.0
        color=(7+int(8*fraction),59+int(17*fraction),76+int(11*fraction))
        draw.line([(0,y),(1279,y)],fill=color,width=1)
    draw.rounded_rectangle((78,66,151,140),radius=14,outline=GOLD,width=3)
    draw.text((95,85),"JFN",font=font(SERIF,32),fill=CREAM)
    draw.text((169,76),"DR. JOÃO DE FREITAS NETO",font=font(SERIF,27),fill=CREAM)
    draw.text((170,115),"AURORA NEXUS   •   REDE MÉDICA WMGJ",font=font(BOLD,15),fill=PALE)
    draw.line([(79,164),(1200,164)],fill=GOLD,width=3)
    draw.text((80,202),f"PASSO {index:02d} / 03",font=font(BOLD,18),fill=GOLD)
    maxwidth=1100
    titlefont=font(SERIF,56)
    if draw.textbbox((0,0),headline,font=titlefont)[2]>maxwidth:titlefont=font(SERIF,44)
    draw.text((78,254),headline,font=titlefont,fill=CREAM)
    y=350
    for line in lines:
        draw.rounded_rectangle((81,y+9,95,y+23),radius=3,fill=GOLD)
        draw.text((118,y),line,font=font(REGULAR,29),fill=MUTED)
        y+=61
    draw.text((80,652),"Cadastro voluntário  •  Documentos sujeitos à conferência",font=font(REGULAR,18),fill=PALE)
    draw.text((1145,652),"2026",font=font(BOLD,18),fill=GOLD)
    path=TEMP/f"slide{index}.png";im.save(path);return path

def main():
    inputs=[
        slide(1,"Identifique seu perfil",["Informe seu nome e contato","Registre CRM e unidade federativa","Indique sua especialidade e RQE, se houver"]),
        slide(2,"Selecione suas oportunidades",["Áreas assistenciais e de gestão","Regiões e horários disponíveis","Modalidades de prestação de serviços"]),
        slide(3,"Anexe sua documentação",["Utilize seu convite individual","PDF, JPG ou PNG — até 4 MB cada","Guarde o protocolo; a equipe fará a revisão"])
    ]
    playlist=TEMP/"playlist.txt"
    values=[]
    for path in inputs:
        values.append("file '"+str(path).replace("\\","/").replace("'","'\\''")+"'")
        values.append("duration 3.2")
    values.append("file '"+str(inputs[-1]).replace("\\","/")+"'")
    playlist.write_text("\n".join(values)+"\n",encoding="utf-8")
    target=OUT/"guia-pre-cadastro-medico.mp4"
    command=[get_ffmpeg_exe(),"-y","-hide_banner","-loglevel","error","-safe","0","-f","concat","-i",str(playlist),
      "-r","12","-c:v","libx264","-preset","fast","-crf","29",
      "-pix_fmt","yuv420p","-movflags","+faststart","-an",str(target)]
    subprocess.run(command,check=True,timeout=180)
    data=target.read_bytes()
    if len(data)<1024 or b"ftyp" not in data[:40]:raise ValueError("INVALID_VIDEO_CONTAINER")
    print(f"VIDEO_CREATED {target.name} size={len(data)}")
if __name__=="__main__":main()
