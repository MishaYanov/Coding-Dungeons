from pathlib import Path
import copy
import json
import math
import re
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (
    BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, PageBreak,
    Flowable, KeepTogether,
)
from reportlab.platypus.tableofcontents import TableOfContents
from pypdf import PdfReader
import build_book as base

ROOT=base.ROOT
DATA=ROOT/'work/gamebook'
QA=ROOT/'work/qa/campaign'
QA.mkdir(parents=True,exist_ok=True)
OUTPUT=ROOT/'outputs/Understanding_Rust_Campaign.pdf'
OUTPUT.parent.mkdir(parents=True,exist_ok=True)
INK=colors.HexColor('#142435')
ORANGE=colors.HexColor('#C85029')
TEAL=colors.HexColor('#087F83')
MUTED=colors.HexColor('#526373')
PALE=colors.HexColor('#E9EFF2')
WHITE=colors.white
W,H=base.PAGE_W,base.PAGE_H
WIDTH,HEIGHT=base.WIDTH,base.HEIGHT
ST=base.STYLES
ST['mission']=ParagraphStyle('mission',fontName='HeadBold',fontSize=24,
    leading=27,spaceAfter=14,keepWithNext=True,textColor=INK)
ST['kicker']=ParagraphStyle('kicker',fontName='HeadBold',fontSize=9,
    leading=12,spaceBefore=4,spaceAfter=8,keepWithNext=True,textColor=ORANGE)
ST['nav']=ParagraphStyle('nav',fontName='Head',fontSize=9.1,leading=13,
    spaceBefore=5,spaceAfter=10,textColor=INK)
ST['small']=ParagraphStyle('small',fontName='Head',fontSize=9.2,leading=12.6,
    spaceAfter=6,textColor=MUTED)
ST['manual']=ParagraphStyle('manual',fontName='HeadBold',fontSize=17,
    leading=21,spaceBefore=16,spaceAfter=12,keepWithNext=True,textColor=INK)
ST['hint']=ParagraphStyle('hint',fontName='HeadBold',fontSize=13.5,
    leading=17,spaceBefore=16,spaceAfter=7,keepWithNext=True,textColor=INK)

ZONES=[
    (1,8,'The Borrowed Citadel','Ownership and resource logic',ORANGE),
    (9,18,'The Trait Foundry','Types and public interfaces',TEAL),
    (19,28,'The Clockwork Wilds','Concurrency and asynchronous systems',
     colors.HexColor('#665494')),
    (29,36,'The Unsafe Depths','Memory representation and proof obligations',
     colors.HexColor('#9B5C22')),
    (37,42,'The Endgame','Complete systems and their failure modes',
     colors.HexColor('#386B48')),
]
PATHS=[
    {'id':'architect','name':'The Architect','color':TEAL,
     'levels':[1,3,4,5,9,10,11,12,13,14,15,16,17,18,33,41],
     'description':'You rebuild the contracts between districts. Follow '
         'trait obligations, borrowing interfaces, type erasure, and API '
         'evolution until another team can use your library without sharing '
         'your implementation assumptions. Your final contract is a crate '
         'whose feature combinations and public promises remain coherent.',
     'artifact':'A public API dossier with accepted and rejected examples, '
         'an error policy, and a compatibility argument.'},
    {'id':'warden','name':'The Warden','color':colors.HexColor('#665494'),
     'levels':[1,3,6,7,19,20,21,22,23,24,25,26,27,28,38,39,40],
     'description':'You restore the towers that move work through Ferrum. '
         'Follow capabilities across threads, queues, suspension points, '
         'wakeups, and cancellation. Your final contract is a service whose '
         'accepted work has an explicit fate during overload, failure, and '
         'shutdown. A process that merely stays memory safe is not yet rescued.',
     'artifact':'A wait graph, resource budget, shutdown protocol, and '
         'fault-injection record for one concurrent service.'},
    {'id':'delver','name':'The Delver','color':ORANGE,
     'levels':[1,2,3,4,5,6,7,8,22,24,29,30,31,32,33,34,35,36],
     'description':'You descend beneath the safe interfaces to inspect '
         'representation, validity, initialization, and reclamation. Take '
         'the safe alternative whenever it meets the contract. When unsafe '
         'operations are necessary, make each obligation and owner visible. '
         'Your final contract is an abstraction whose implementation can be '
         'audited beyond the happy path.',
     'artifact':'An unsafe proof ledger plus boundary, panic, and '
         'initialization tests and a measured cost comparison.'},
    {'id':'pathfinder','name':'The Pathfinder','color':colors.HexColor('#386B48'),
     'levels':[1,3,4,8,13,14,15,34,37,38,39,40,41,42],
     'description':'You connect isolated repairs into working systems. '
         'Follow retained bytes through a parser, stale decisions through a '
         'store, and accepted jobs through a pipeline. Your final contract '
         'is a design review that explains what types guarantee, what '
         'runtime checks establish, and what depends on another component.',
     'artifact':'One complete design study with an ownership diagram, '
         'failure table, and defended tradeoffs.'},
]

def link(label,key):
    return f'<link href="#{key}"><u>{base.inline(label)}</u></link>'

def para(text,style='body'):
    return Paragraph(base.inline(text),ST[style])

def heading(title,key,style='h1',toc=True,outline=0):
    p=para(title,style)
    p._bookmark=key
    p._toc_title=title
    p._toc_include=toc
    p._outline_level=outline
    return p

def bullet(text):
    return Paragraph('<b>•</b> '+base.inline(text),ST['body'])

def zone_of(level):
    return next((i+1,z) for i,z in enumerate(ZONES) if z[0]<=level<=z[1])

def fit_text(canvas,text,max_width,font='Head',size=9):
    if base.pdfmetrics.stringWidth(text,font,size)<=max_width:
        return text
    while text and base.pdfmetrics.stringWidth(text+'...',font,size)>max_width:
        text=text[:-1]
    return text.rstrip()+'...'

class Cover(Flowable):
    def wrap(self,aw,ah):
        return aw,HEIGHT
    def draw(self):
        c=self.canv
        c.setFillColor(ORANGE)
        c.setFont('HeadBold',12)
        c.drawString(0,HEIGHT-22,'THE FERRUM EXPEDITION')
        c.setFillColor(WHITE)
        c.setFont('HeadBold',32)
        c.drawString(0,HEIGHT-90,'UNDERSTANDING')
        c.setFont('HeadBold',77)
        c.drawString(-2,HEIGHT-170,'RUST')
        c.setFont('Head',17)
        c.drawString(0,HEIGHT-209,'CAMPAIGN EDITION')
        c.setFont('Head',11)
        c.drawString(0,HEIGHT-248,'42 levels  /  4 paths  /  5 zones')
        c.drawString(0,HEIGHT-267,'Advanced concepts for experienced developers')
        c.setFont('Head',10)
        c.setFillColor(colors.HexColor('#BBCBD7'))
        c.drawString(0,54,'Choose a route. Build an artifact. Defend the invariant.')
        c.drawString(0,18,'Rust 2024 edition     /     November 2026')
        # An original vector city and its broken circuit routes.
        c.setStrokeColor(colors.HexColor('#476177'))
        c.setLineWidth(1)
        towers=[(8,110,35,55),(62,110,28,96),(113,110,37,69),
                (169,110,31,113),(221,110,33,82),(278,110,45,58)]
        for x,y,w,h in towers:
            c.rect(x,y,w,h,fill=0,stroke=1)
            c.line(x+w/2,y+h,x+w/2,y+h+15)
        c.setStrokeColor(ORANGE)
        c.setLineWidth(2)
        points=[(25,137),(75,174),(131,143),(185,192),(237,160),(299,137)]
        for i,((x,y),(nx,ny)) in enumerate(zip(points,points[1:])):
            if i==2:
                c.setDash(3,3)
            else:
                c.setDash()
            c.line(x,y,nx,ny)
        c.setDash()
        for i,(x,y) in enumerate(points):
            c.setFillColor(INK)
            c.circle(x,y,7,fill=1,stroke=1)
            c.setFillColor(ORANGE)
            c.circle(x,y,2,fill=1,stroke=0)

class WorldMap(Flowable):
    def wrap(self,aw,ah):
        self.width=aw
        self.height=397
        return aw,self.height
    def draw(self):
        c=self.canv
        for zi,(first,last,name,theme,color) in enumerate(ZONES):
            y=self.height-zi*70-12
            c.setFillColor(color)
            c.setFont('HeadBold',12)
            c.drawString(0,y,f'{zi+1:02}  {name}')
            c.setFillColor(MUTED)
            c.setFont('Head',8.5)
            c.drawString(0,y-13,theme)
            count=last-first+1
            start=(WIDTH-(count-1)*32)/2
            for index,level in enumerate(range(first,last+1)):
                x=start+index*32
                cy=y-35
                if index<count-1:
                    c.setStrokeColor(PALE)
                    c.setLineWidth(2)
                    c.line(x+11,cy,x+21,cy)
                c.setFillColor(color)
                c.circle(x,cy,11,fill=1,stroke=0)
                c.setFillColor(WHITE)
                c.setFont('HeadBold',10)
                c.drawCentredString(x,cy-3.3,str(level))
                c.linkRect(f'Enter level {level}',f'level{level:02}',
                    (x-13,cy-13,x+13,cy+13),relative=1,thickness=0)
        c.setFillColor(INK)
        c.setFont('HeadBold',10)
        c.drawString(0,20,'OPTIONAL PORTALS')
        for x,label,target in [(0,'Choose a path','paths'),
                               (118,'Branching rooms','rooms'),
                               (245,'The hint vault','vault')]:
            c.setFillColor(TEAL)
            c.setFont('Head',9.5)
            c.drawString(x,2,label)
            c.linkRect(label,target,(x,-2,x+105,14),relative=1,thickness=0)

class RouteNodes(Flowable):
    def __init__(self,path):
        Flowable.__init__(self)
        self.path=path
    def wrap(self,aw,ah):
        self.width=aw
        self.height=math.ceil(len(self.path['levels'])/9)*35+4
        return aw,self.height
    def draw(self):
        c=self.canv
        for i,level in enumerate(self.path['levels']):
            row,col=divmod(i,9)
            x=col*38+2
            y=self.height-row*35-26
            c.setFillColor(self.path['color'])
            c.roundRect(x,y,25,24,4,fill=1,stroke=0)
            c.setFillColor(WHITE)
            c.setFont('HeadBold',11)
            c.drawCentredString(x+12.5,y+8,str(level))
            c.linkRect(f'Enter level {level}',f'level{level:02}',
                       (x,y,x+25,y+24),relative=1,thickness=0)
            if col<8 and i<len(self.path['levels'])-1:
                c.setStrokeColor(MUTED)
                c.setLineWidth(.7)
                c.line(x+27,y+12,x+34,y+12)

class SaveLedger(Flowable):
    def __init__(self,quests,start,end,first=False):
        Flowable.__init__(self)
        self.quests=quests
        self.start=start
        self.end=end
        self.first=first
    def wrap(self,aw,ah):
        self.width=aw
        self.height=440
        return aw,self.height
    def draw(self):
        c=self.canv
        if self.first:
            for x,w,label,name in [(0,128,'CALLSIGN','callsign'),
                                  (140,120,'ACTIVE PATH','active_path'),
                                  (272,72,'XP TOTAL','xp_total')]:
                c.setFillColor(MUTED)
                c.setFont('HeadBold',7)
                c.drawString(x,self.height-9,label)
                c.acroForm.textfield(name=name,tooltip=label,x=x,
                    y=self.height-33,width=w,height=19,
                    relative=True,borderWidth=.7,borderColor=MUTED,
                    fillColor=WHITE,textColor=INK,fontName='Helvetica',
                    fontSize=9,maxlen=60,fieldFlags='')
        else:
            c.setFillColor(MUTED)
            c.setFont('Head',9)
            c.drawString(0,self.height-19,
                'Continue your marks. Keep evidence in the quest journal.')
        cols=[224,254,284,314]
        phases=[('scout','SCOUT 20'),('forge','FORGE 40'),
                ('explain','EXPLAIN 40'),('side','SIDE 25')]
        c.setFillColor(INK)
        c.setFont('HeadBold',8)
        c.drawString(0,self.height-57,'LEVEL AND MISSION')
        for x,(_,label) in zip(cols,phases):
            phase,weight=label.split()
            c.setFont('HeadBold',6.8)
            c.drawCentredString(x+5.5,self.height-51,phase)
            c.setFont('Head',6.7)
            c.drawCentredString(x+5.5,self.height-62,weight+' XP')
        for row,level in enumerate(range(self.start,self.end+1)):
            y=self.height-80-row*16.2
            q=self.quests[level]
            if row%2==0:
                c.setFillColor(colors.HexColor('#F1F4F5'))
                c.rect(0,y-2,WIDTH,16,fill=1,stroke=0)
            c.setFillColor(INK)
            c.setFont('Head',8.2)
            label=fit_text(c,f'{level:02}  {q["mission_title"]}',208,
                           size=8.2)
            c.drawString(3,y+2,label)
            c.linkRect(f'Enter level {level}',f'level{level:02}',
                (0,y-2,210,y+14),relative=1,thickness=0)
            for x,(phase,_) in zip(cols,phases):
                c.acroForm.checkbox(name=f'level{level:02}_{phase}',
                    tooltip=f'Level {level} {phase}',x=x,y=y,
                    size=10.5,relative=True,checked=False,
                    borderWidth=.7,borderColor=MUTED,fillColor=WHITE,
                    textColor=TEAL,buttonStyle='check',fieldFlags='')
        c.setFillColor(MUTED)
        c.setFont('Head',8.5)
        c.drawString(0,5,'Core mastery = Scout + Forge + Explain. Side quests are optional.')

class VaultDirectory(Flowable):
    def wrap(self,aw,ah):
        self.width=aw
        self.height=423
        return aw,self.height
    def draw(self):
        c=self.canv
        for level in range(1,43):
            col,row=divmod(level-1,21)
            x=col*176
            y=self.height-row*19.3-13
            c.setFillColor(ORANGE)
            c.setFont('HeadBold',9)
            c.drawString(x,y,f'{level:02}')
            for dx,label,suffix in [(23,'Nudge','n'),(66,'Tactic','t'),
                                    (108,'Debrief','d')]:
                c.setFillColor(INK)
                c.setFont('Head',8.6)
                c.drawString(x+dx,y,label)
                c.linkRect(f'{label} for level {level}',
                    f'hint{level:02}_{suffix}',
                    (x+dx,y-3,x+dx+40,y+10),relative=1,thickness=0)

class GameDoc(BaseDocTemplate):
    def __init__(self,path):
        super().__init__(str(path),pagesize=(W,H),
            leftMargin=base.MARGIN_X,rightMargin=base.MARGIN_X,
            topMargin=base.MARGIN_TOP,bottomMargin=base.MARGIN_BOTTOM,
            title='Understanding Rust The Ferrum Expedition',
            author='Advanced Rust Campaign',
            subject='An explorable advanced Rust gamebook',pageCompression=1)
        frame=Frame(base.MARGIN_X,base.MARGIN_BOTTOM,WIDTH,HEIGHT,
            leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0,
            id='game')
        self.addPageTemplates(PageTemplate(id='game',frames=frame,
                                          onPage=self.decorate))
        self.locations={}
    def decorate(self,c,doc):
        if doc.page==1:
            c.setFillColor(INK)
            c.rect(0,0,W,H,fill=1,stroke=0)
            return
        c.saveState()
        c.setFillColor(MUTED)
        c.setFont('Head',7.8)
        c.drawString(base.MARGIN_X,H-26,'UNDERSTANDING RUST / FERRUM')
        c.setFont('Head',8.4)
        for x,label,target in [(base.MARGIN_X,'Map','world'),
                               (base.MARGIN_X+40,'Save','save'),
                               (base.MARGIN_X+84,'Vault','vault')]:
            c.drawString(x,25,label)
            c.linkRect(label,target,(x,21,x+31,35),thickness=0)
        c.drawRightString(W-base.MARGIN_X,25,str(doc.page))
        c.restoreState()
    def afterFlowable(self,f):
        key=getattr(f,'_bookmark',None)
        if key:
            title=f._toc_title
            top=min(H-38,self.frame._y+getattr(f,'height',0)+f.getSpaceAfter())
            self.canv.bookmarkPage(key,fit='XYZ',left=0,top=top,zoom=0)
            self.canv.addOutlineEntry(title,key,
                level=getattr(f,'_outline_level',0),closed=True)
            if getattr(f,'_toc_include',True):
                self.notify('TOCEntry',(0,title,self.page,key))
            self.locations[key]=self.page

def transform_paragraph(p):
    chunks=re.split(r'(<[^>]+>)',p.text)
    for i in range(0,len(chunks),2):
        text=chunks[i]
        text=re.sub(r'\bChapter\b','Level',text)
        text=re.sub(r'\bChapters\b','Levels',text)
        text=re.sub(r'\bchapter\b','level',text)
        text=re.sub(r'\bchapters\b','levels',text)
        text=text.replace('Exercises and Reasoned Solutions',
                          'Training Encounters and Debriefs')
        text=text.replace('Reasoned Solutions','Training Debriefs')
        text=text.replace('Exercises','Training Encounters')
        chunks[i]=text
    text=''.join(chunks)
    return Paragraph(text,p.style)

def manual(level):
    source=base.parse_manuscript(base.SOURCE/f'ch{level:02}.txt',level)
    title=re.sub(r'^# Chapter\s+\d+\s+','',
        (base.SOURCE/f'ch{level:02}.txt').read_text(encoding='utf-8').splitlines()[0])
    first=Paragraph('<font name="Head" size="9">FIELD MANUAL '+str(level)+
        '</font><br/>'+base.inline(title),ST['manual'])
    first._bookmark=f'ch{level:02}'
    first._toc_title=title
    first._toc_include=False
    first._outline_level=1
    out=[first]
    for f in source[1:]:
        if isinstance(f,Paragraph):
            out.append(transform_paragraph(f))
        elif isinstance(f,KeepTogether):
            out.append(KeepTogether([transform_paragraph(x)
                if isinstance(x,Paragraph) else x for x in f._content]))
        else:
            out.append(f)
    return out

def level_entry(q):
    n=q['level']
    zi,z=zone_of(n)
    out=[PageBreak(),para(f'ZONE {zi} / {z[2].upper()} / LEVEL {n:02}','kicker'),
         heading(q['mission_title'],f'level{n:02}','mission',toc=True)]
    out[-1]._toc_title=f'Level {n:02}  {q["mission_title"]}'
    out.append(para(q['scene']))
    out.append(Paragraph('<b>Mission</b> '+base.inline(q['objective']),ST['body']))
    if q['loadout']:
        out.append(Paragraph('<b>Suggested loadout</b> '+', '.join(
            link(f'Level {v}',f'level{v:02}') for v in q['loadout'])+
            '. These are guidance, not locked gates.',ST['small']))
    out.append(para('Mastery Targets','h3'))
    out.extend(bullet(t) for t in q['win_conditions'])
    out.append(Paragraph('  /  '.join([
        link('Enter the manual',f'ch{n:02}'),
        link('Attempt the boss',f'boss{n:02}'),
        link('World map','world')]),ST['nav']))
    out.extend(manual(n))
    out.append(heading(q['boss_title'],f'boss{n:02}','manual',
                       toc=False,outline=1))
    out.append(para('BOSS ENCOUNTER / FORGE 40 / EXPLAIN 40','kicker'))
    out.append(para(q['boss_brief']))
    out.append(para('Encounter Constraints','h3'))
    out.extend(bullet(t) for t in q['constraints'])
    out.append(Paragraph('  /  '.join([
        link('Hint one',f'hint{n:02}_n'),
        link('Hint two',f'hint{n:02}_t'),
        link('Reveal debrief',f'hint{n:02}_d')]),ST['nav']))
    tail_start=len(out)
    out.append(heading('Side Quest',f'side{n:02}','h3',toc=False,outline=1))
    out.append(para(q['side_quest']))
    out.append(Paragraph('<b>Capability unlocked</b> '+base.inline(q['reward']),
                         ST['body']))
    out.append(para('Choose Your Exit','h3'))
    for door in q['route_choices']:
        out.append(Paragraph(link(door['label']+f' / Level {door["level"]}',
            f'level{door["level"]:02}')+'<br/>'+base.inline(door['reason']),
            ST['nav']))
    out.append(Paragraph(link('Mark your quest log','save')+'  /  '+
                         link('Return to the map','world'),ST['nav']))
    out=out[:tail_start]+[KeepTogether(out[tail_start:])]
    return out

def route_pages():
    out=[]
    for pair in range(2):
        out.append(PageBreak())
        out.append(heading('Choose a Path' if pair==0 else 'Two More Paths',
                           'paths' if pair==0 else 'paths2'))
        out.append(para('Click any node to enter. Change paths when a '
                        'different problem catches your attention.','small'))
        for path in PATHS[pair*2:pair*2+2]:
            out.append(heading(path['name'],path['id'],'h2',toc=False))
            out.append(para(path['description']))
            out.append(RouteNodes(path))
            out.append(Paragraph('<b>Route artifact</b> '+
                base.inline(path['artifact']),ST['small']))
    return out

def room_pages(rooms):
    out=[PageBreak(),heading('The Branching Rooms','rooms'),
         para('Three optional diagnostic encounters. Pick an action first, '
              'then follow its link to the consequence. Afterward change '
              'one requirement and see whether your choice still holds.')]
    for room in rooms:
        out.append(heading(room['title'],'room_'+room['id'],'h2',toc=False))
        out.append(para(room['brief']))
        for i,choice in enumerate(room['choices'],1):
            out.append(Paragraph(link(f'{i}  {choice["label"]}',
                f'outcome_{room["id"]}_{i}'),ST['nav']))
        out.append(Paragraph('<b>Remix</b> '+base.inline(room['remix']),ST['body']))
        if room!=rooms[-1]:
            out.append(PageBreak())
    return out

def vault(quests,rooms):
    out=[PageBreak(),heading('The Hint Vault','vault'),
         para('Choose how much help to reveal. Nudges, tactics, and '
              'debriefs occupy separate sections so the answer is not '
              'immediately below the first hint. Every entry links back '
              'to its boss encounter.','small'),VaultDirectory()]
    for suffix,name,field,blurb in [
        ('n','The Nudge Gallery','hint1','A change of attention before a solution.'),
        ('t','The Tactics Workshop','hint2','A concrete reasoning step for a blocked attempt.'),
        ('d','The Debrief Archive','debrief','Compare arguments after producing your own evidence.'),
    ]:
        out.extend([PageBreak(),heading(name,'vault_'+suffix),para(blurb,'small')])
        for n in range(1,43):
            q=quests[n]
            entry=[heading(f'Level {n:02}  {q["boss_title"]}',
                f'hint{n:02}_{suffix}','hint',toc=False,outline=1),
                para(q[field])]
            links=[link('Return to the encounter',f'boss{n:02}')]
            if suffix=='n':
                links.append(link('Need a tactic',f'hint{n:02}_t'))
            elif suffix=='t':
                links.append(link('Reveal debrief',f'hint{n:02}_d'))
            else:
                links.append(link('Record your evidence','save'))
            entry.append(Paragraph('  /  '.join(links),ST['nav']))
            out.append(KeepTogether(entry))
    out.extend([PageBreak(),heading('Consequences in the Branching Rooms',
                                    'room_outcomes')])
    for room in rooms:
        for i,choice in enumerate(room['choices'],1):
            entry=[heading(f'{room["title"]} / Choice {i}',
                f'outcome_{room["id"]}_{i}','hint',toc=False,outline=1),
                para(choice['result'])]
            entry.append(Paragraph(link('Return to the room','room_'+room['id'])+
                '  /  '+link(f'Explore Level {choice["level"]}',
                              f'level{choice["level"]:02}'),ST['nav']))
            out.append(KeepTogether(entry))
    return out

def story(quests,rooms,locations=None):
    out=[Cover(),PageBreak()]
    launch=base.parse_manuscript(DATA/'launch.txt')
    launch[0]._bookmark='launch'
    out.extend(launch)
    out.extend([PageBreak(),heading('World Map','world'),
        para('Every numbered node is an unlocked door. Follow the whole '
             'campaign, choose a path, or jump to a system you want to repair.',
             'small'),WorldMap()])
    out.extend(route_pages())
    for first,last,key,title in [(1,21,'save','Save Room One'),
                                  (22,42,'save2','Save Room Two')]:
        out.extend([PageBreak(),heading(title,key),
            para('Mark evidence, then save your own copy. Core marks earn '
                 '20 + 40 + 40 XP; a completed side quest earns 25. '
                 'Tally XP yourself.','small'),
            SaveLedger(quests,first,last,first==1)])
    out.extend(room_pages(rooms))
    out.extend([PageBreak(),heading('Campaign Directory','directory',toc=False)])
    toc=TableOfContents()
    toc.levelStyles=[ParagraphStyle('game_toc',fontName='Head',fontSize=9.7,
        leading=12.7,spaceBefore=2,rightIndent=24,textColor=INK)]
    toc.dotsMinLevel=0
    out.append(toc)
    for n in range(1,43):
        out.extend(level_entry(quests[n]))
    out.extend(vault(quests,rooms))
    for name in ['appendix_a','appendix_b']:
        out.append(PageBreak())
        blocks=base.parse_manuscript(base.SOURCE/f'{name}.txt')
        out.extend(blocks)
    locs=locations or {f'ch{n:02}':0 for n in range(1,43)}
    index=base.make_index(locs)
    for i,f in enumerate(index):
        if isinstance(f,Paragraph):
            text=f.text.replace('chapter openings','field manual openings')
            text=text.replace('relevant chapter','relevant field manual')
            p=Paragraph(text,f.style)
            for attr in ['_bookmark','_toc_title']:
                if hasattr(f,attr):
                    setattr(p,attr,getattr(f,attr))
            index[i]=p
    out.extend(index)
    return out

def main():
    all_quests=[]
    for suffix in 'abc':
        all_quests.extend(json.loads((DATA/f'quests_{suffix}.json').read_text(
            encoding='utf-8-sig')))
    quests={q['level']:q for q in all_quests}
    assert set(quests)==set(range(1,43))
    rooms=json.loads((DATA/'rooms.json').read_text(encoding='utf-8'))
    for n,q in quests.items():
        assert len(q['win_conditions'])==3
        assert len(q['constraints'])==3
        assert len(q['route_choices'])==2
        assert all(v<n and v>=1 for v in q['loadout'])
        assert all(1<=d['level']<=42 and d['level']!=n
                   for d in q['route_choices'])
    doc=GameDoc(OUTPUT)
    doc.multiBuild(story(quests,rooms),maxPasses=5)
    locations=dict(doc.locations)
    doc=GameDoc(OUTPUT)
    doc.multiBuild(story(quests,rooms,locations),maxPasses=5)
    reader=PdfReader(OUTPUT)
    fields=reader.get_fields() or {}
    metrics={'pages':len(reader.pages),'levels':42,'paths':4,'zones':5,
             'bosses':42,'side_quests':42,'branching_rooms':3,
             'form_fields':len(fields),'locations':doc.locations,
             'body_point_size':10.5,'body_leading':14.8,
             'technical_source_words':sum(len(p.read_text(encoding='utf-8').split())
                 for p in base.SOURCE.glob('ch*.txt')),
             'quest_words':len(json.dumps(all_quests,ensure_ascii=False).split())}
    (QA/'metrics.json').write_text(json.dumps(metrics,indent=2),encoding='utf-8')
    (DATA/'campaign.json').write_text(json.dumps({'paths':PATHS,'quests':all_quests,
        'rooms':rooms},ensure_ascii=False,indent=2,default=lambda c:c.hexval()),
        encoding='utf-8')
    print(json.dumps({k:v for k,v in metrics.items() if k!='locations'},indent=2))

if __name__=='__main__':
    main()
