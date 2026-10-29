"""AURORA CRED-MED public blank PDF templates (no personal data).

Dependency: reportlab. Output is deterministic and targets Firebase Hosting's
existing static directory; never use this path for applicants' private uploads.
"""
from __future__ import annotations
import hashlib, json, sys
from pathlib import Path
from reportlab.pdfgen.canvas import Canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib.colors import HexColor
from reportlab.lib.utils import simpleSplit

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/"hosting"/"aurora-nexus"/"arquivos"/"wmgj"
OUT.mkdir(parents=True,exist_ok=True)
INK=HexColor("#073B4C")
TEAL=HexColor("#206A71")
GOLD=HexColor("#C59A45")
CREAM=HexColor("#F7F3EC")
MUTED=HexColor("#5A6E70")
LINE=HexColor("#D6E1DE")
WHITE=HexColor("#FFFFFF")
W,H=A4
LEFT=46
RIGHT=W-LEFT

def canvas(name,title):
    c=Canvas(str(OUT/name),pagesize=A4,invariant=1,pageCompression=1)
    c.setTitle(title);c.setAuthor("Dr. João de Freitas Neto | WMGJ")
    c.setSubject("Modelo institucional público, sem dados pessoais")
    return c

def line(c,x1,y1,x2,y2,color=LINE,width=0.9):
    c.setStrokeColor(color);c.setLineWidth(width);c.line(x1,y1,x2,y2)

def text(c,x,y,value,size=10,font="Helvetica",color=INK):
    c.setFont(font,size);c.setFillColor(color);c.drawString(x,y,value)

def header(c,subtitle,title,code,page=1):
    c.setFillColor(CREAM);c.rect(0,0,W,H,fill=1,stroke=0)
    c.setFillColor(INK);c.rect(0,H-112,W,112,fill=1,stroke=0)
    c.setFillColor(GOLD);c.rect(0,H-116,W,4,fill=1,stroke=0)
    c.setStrokeColor(GOLD);c.setLineWidth(1.5);c.roundRect(LEFT,H-85,44,46,8,fill=0,stroke=1)
    text(c,LEFT+9,H-68,"JFN",16,"Times-Bold",WHITE)
    text(c,LEFT+59,H-49,"DR. JOÃO DE FREITAS NETO",14,"Times-Bold",WHITE)
    text(c,LEFT+59,H-69,subtitle.upper(),7.7,"Helvetica",HexColor("#DBE9E6"))
    text(c,LEFT,H-150,code.upper(),8.2,"Helvetica-Bold",TEAL)
    text(c,LEFT,H-186,title,23,"Times-Roman",INK)
    line(c,LEFT,H-199,RIGHT,H-199,GOLD,1.3)
    footer(c,code,page)
    return H-222

def footer(c,code,page):
    line(c,LEFT,51,RIGHT,51)
    text(c,LEFT,38,"AURORA NEXUS  |  WMGJ  |  REDE DE MÉDICOS PARCEIROS",8,"Helvetica-Bold",INK)
    text(c,LEFT,25,"Documento de pré-cadastro - não representa contratação ou habilitação.",7.3,"Helvetica",MUTED)
    c.setFont("Helvetica",7.5);c.setFillColor(MUTED);c.drawRightString(RIGHT,38,f"{code}  |  {page}")

def paragraph(c,content,y,width=RIGHT-LEFT,size=9.3,leading=13,color=INK,spacing=7):
    for segment in content.split("\n"):
        if not segment.strip():y-=leading/2;continue
        for part in simpleSplit(segment,"Helvetica",size,width):
            text(c,LEFT,y,part,size,"Helvetica",color)
            y-=leading
        y-=spacing
    return y

def section(c,y,name):
    text(c,LEFT,y,name.upper(),10,"Helvetica-Bold",TEAL)
    line(c,LEFT,y-8,RIGHT,y-8,LINE)
    return y-32

def field(c,x,y,label,length=206):
    text(c,x,y,label.upper(),7.6,"Helvetica-Bold",MUTED)
    line(c,x,y-22,x+length,y-22,HexColor("#94ABA7"))
    return y-44

def check(c,x,y,label):
    c.setLineWidth(0.85);c.setStrokeColor(TEAL);c.rect(x,y-1,8.5,8.5,fill=0,stroke=1)
    text(c,x+15,y,label,8.5,"Helvetica",INK)

def ficha():
    c=canvas("ficha-pre-cadastro-medico.pdf","Ficha de pré-cadastro - médicos parceiros WMGJ")
    y=header(c,"Cuidado clínico integral | AURORA NEXUS","Ficha de pré-cadastro","AURORA-CRED-MED-001 / FICHA")
    y=paragraph(c,"Instrumento de manifestação inicial de interesse para oportunidades assistenciais e de gestão. O preenchimento não assegura contratação, plantões ou aprovação documental.",y,size=9.2,leading=13)
    y=section(c,y-3,"01 - Identificação e inscrição profissional")
    a=field(c,LEFT,y,"Nome completo",497);y=a
    a=field(c,LEFT,y,"E-mail profissional",235)
    b=field(c,LEFT+257,y,"Celular / WhatsApp",240)
    y=min(a,b)
    a=field(c,LEFT,y,"CRM / UF",235)
    b=field(c,LEFT+257,y,"Município / UF de residência",240)
    y=min(a,b)
    a=field(c,LEFT,y,"Área de atuação principal",235)
    b=field(c,LEFT+257,y,"RQE (se houver)",240)
    y=min(a,b)
    y=section(c,y,"02 - Experiência e disponibilidade")
    a=field(c,LEFT,y,"Anos de experiência",235)
    b=field(c,LEFT+257,y,"Regiões / cidades de interesse",240)
    y=min(a,b)
    check(c,LEFT,y,"UTI adulto");check(c,LEFT+108,y,"Emergência");check(c,LEFT+225,y,"Enfermaria");check(c,LEFT+340,y,"Ambulatório")
    y-=24
    check(c,LEFT,y,"Cardiologia");check(c,LEFT+130,y,"Ecocardiografia");check(c,LEFT+288,y,"Auditoria");check(c,LEFT+395,y,"Outros")
    y-=28
    check(c,LEFT,y,"Diurno");check(c,LEFT+98,y,"Noturno");check(c,LEFT+195,y,"12h / 24h");check(c,LEFT+317,y,"Fins de semana")
    y-=28
    y=section(c,y,"03 - Anexos para envio no portal")
    y=paragraph(c,"Carteira profissional CRM; certidão de inscrição/regularidade; diploma; RQE quando aplicável; currículo; certificados de treinamentos conforme a vaga (BLS, ACLS, ATLS ou equivalentes quando exigidos).",y,size=8.9,leading=12,spacing=3)
    check(c,LEFT,y,"Declaro a veracidade das informações e reconheço que os documentos serão conferidos.")
    y-=25
    check(c,LEFT,y,"Desejo contato sobre oportunidades futuras (opcional).")
    y-=23
    y=paragraph(c,"Envio seguro de arquivos: utilizar o link individual fornecido pela gestão WMGJ. Não encaminhar informações clínicas de pacientes. Os documentos serão tratados conforme o aviso de privacidade vigente.",y,size=8.3,leading=11,spacing=2)
    if y<79: raise ValueError(f"Ficha passou da área útil: {y}")
    c.showPage();c.save()
    return OUT/"ficha-pre-cadastro-medico.pdf"

def termo():
    c=canvas("termo-pre-credenciamento-medico.pdf","Termo preliminar de interesse - médicos parceiros WMGJ")
    y=header(c,"Cuidado clínico integral | AURORA NEXUS","Termo de pré-credenciamento","AURORA-CRED-MED-001 / TERMO")
    clauses=[
      ("1. OBJETO E NATUREZA","O presente termo registra manifestação voluntária de interesse em integrar o banco de médicos parceiros da WMGJ, com vistas à análise de futuras oportunidades profissionais. Não é contrato de prestação de serviços nem promessa de contratação."),
      ("2. AUSÊNCIA DE VÍNCULO","Este instrumento não cria exclusividade, compromisso de plantões, escala de trabalho, remuneração definida, obrigação de contratação ou de aceite de vagas e não configura, por si, vínculo empregatício. Cada oportunidade dependerá de proposta e instrumento específicos."),
      ("3. QUALIFICAÇÃO E EVIDÊNCIAS","O profissional declara dados de CRM, UF, especialidade, RQE quando aplicável, currículo, cursos e disponibilidade. O recebimento de arquivos é distinto da conferência formal no CRM/CFM, da análise de capacitações e da aprovação da instituição contratante."),
      ("4. DOCUMENTOS E TREINAMENTOS","Certificados BLS, ACLS, ATLS e similares são solicitados conforme os requisitos da vaga e as normas pertinentes; não representam exigência universal. Documentos expirados, incompletos ou divergentes poderão impedir indicação até regularização."),
      ("5. DADOS PESSOAIS","A WMGJ utilizará os dados estritamente para pré-cadastro, contato e triagem de oportunidades, sob acesso restrito, conforme aviso de privacidade específico e Lei 13.709/2018. Não enviar dados clínicos ou de pacientes. A consulta, correção e solicitações de direitos poderão ser encaminhadas ao canal institucional wmgjltda@gmail.com."),
      ("6. CONTRATAÇÃO FUTURA","A eventual prestação de serviços exigirá contrato autônomo com identificação das partes, objeto, local, prazo, valores, responsabilidades, regras de confidencialidade e proteção de dados. A assinatura deste termo não substitui aquele contrato."),
      ("7. DECLARAÇÃO","O profissional confirma que forneceu informações verdadeiras e compreende que o cadastro pode ser atualizado, complementado ou recusado após conferência.")
    ]
    for title,body in clauses:
        if y<165:
            c.showPage();y=header(c,"Cuidado clínico integral | AURORA NEXUS","Termo de pré-credenciamento","AURORA-CRED-MED-001 / TERMO",2)
        text(c,LEFT,y,title,9.2,"Helvetica-Bold",TEAL);y-=18
        y=paragraph(c,body,y,size=9,leading=12.6,spacing=6)-2
    y-=16
    if y<120:
        c.showPage();y=header(c,"Cuidado clínico integral | AURORA NEXUS","Assinatura e ciência","AURORA-CRED-MED-001 / TERMO",2)
    line(c,LEFT,y,LEFT+350,y,HexColor("#94ABA7"));y-=15
    text(c,LEFT,y,"NOME E ASSINATURA DO PROFISSIONAL",7.5,"Helvetica-Bold",MUTED)
    y-=32
    line(c,LEFT,y,LEFT+200,y);line(c,LEFT+267,y,RIGHT,y);y-=15
    text(c,LEFT,y,"MUNICÍPIO / UF",7.5,"Helvetica-Bold",MUTED)
    text(c,LEFT+267,y,"DATA",7.5,"Helvetica-Bold",MUTED)
    c.showPage();c.save()
    return OUT/"termo-pre-credenciamento-medico.pdf"

def main():
    files=[ficha(),termo()]
    video=OUT/"guia-pre-cadastro-medico.mp4"
    videoAssets=[]
    if video.is_file():
        content=video.read_bytes()
        if len(content)>500_000 or content[4:8]!=b"ftyp" or b"moov" not in content[:len(content)] or b"mdat" not in content:
            raise ValueError("VIDEO_INVALID_OR_TOO_LARGE")
        videoAssets=[{"name":video.name,"sha256":hashlib.sha256(content).hexdigest(),"bytes":len(content),"mimeType":"video/mp4","streamable":True}]
    manifest={"schemaVersion":1,"scope":"PUBLIC_BLANK_TEMPLATES_ONLY","module":"AURORA-CRED-MED-001","files":[{"name":f.name,"sha256":hashlib.sha256(f.read_bytes()).hexdigest(),"bytes":f.stat().st_size,"mimeType":"application/pdf"} for f in files],"videoAssets":videoAssets}
    (OUT/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    for x in manifest["files"]: print(f"GENERATED {x['name']} bytes={x['bytes']} SHA256={x['sha256']}")
if __name__=="__main__": main()
