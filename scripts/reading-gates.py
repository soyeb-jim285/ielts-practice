# Reading quality gates for original tests: gen-r-* / gen-rg-* JSON. Checks verbatim gap answers, word limits,
# statements copied from the passage (6+ word run) and 6-word overlap with private Cambridge data. Usage: python3 scripts/reading-gates.py data/lr-generated/gen-r-01.json ...
import json,re,glob,sys,collections
ROOT='/stuff/Study/projects/portfolio/ielts-prtactice/'
def nrm(s): return [w.strip("'") for w in re.sub(r"[^a-z0-9']+",' ',s.lower().replace('’',"'").replace('‘',"'")).split() if w.strip("'")]
def variants(a):
    m=re.search(r'\(([^()]*)\)',a)
    if not m: return [' '.join(nrm(a))]
    pre,post=a[:m.start()],a[m.end():]
    return variants(pre+m.group(1)+post)+variants(pre+post)
NUM={'ONE':1,'TWO':2,'THREE':3}
def limit_ok(lim,ans):
    m=re.search(r'\b(ONE|TWO|THREE)\b',lim)
    mx=NUM[m.group(1)];num='NUMBER' in lim
    for v in variants(ans):
        w=0;nn=0;prev=False
        for t in v.split():
            isn=bool(re.search(r'\d',t))
            if isn:
                if not prev: nn+=1
            else: w+=1
            prev=isn
        if (w<=mx and nn<=1) if num else (w+nn<=mx): return True
    return False
_cam=None
def cam():
    global _cam
    if _cam is None:
        sh=set();
        for f in glob.glob(ROOT+'data/cambridge-lr/C*reading*.json'):
            t=json.load(open(f))
            for s in t['sections']:
                txt=[p['text'] for p in s['passage']['paragraphs']]
                for g in s['groups']:
                    txt.append(g.get('content') or '')
                    for q in g['questions']:
                        txt.append(q.get('text') or '')
                        for o in q.get('options') or []: txt.append(o['text'])
                    for o in g.get('options') or []: txt.append(o['text'])
                for x in txt:
                    w=nrm(x)
                    for i in range(len(w)-5): sh.add(' '.join(w[i:i+6]))
        _cam=sh
    return _cam
def longest_run(a,b):
    A=nrm(a);B=nrm(b);best=0
    pos=collections.defaultdict(list)
    for i,w in enumerate(B): pos[w].append(i)
    for i,w in enumerate(A):
        for j in pos[w]:
            k=0
            while i+k<len(A) and j+k<len(B) and A[i+k]==B[j+k]: k+=1
            best=max(best,k)
    return best
def check(path):
    t=json.load(open(path));bad=[]
    sh=cam()
    allq=[]
    for s in t['sections']:
        p=s['passage'];ptxt='\n'.join(x['text'] for x in p['paragraphs']);hay=' '+' '.join(nrm(ptxt))+' '
        w=len(ptxt.split())
        print(f"  S{s['part']} {p['title']!r} {w}w {len(p['paragraphs'])}p labelled={bool(p['paragraphs'][0].get('label'))} groups={[g['type'] for g in s['groups']]}")
        # cambridge n-gram
        for txt in [ptxt]+[ (g.get('content') or '')+' '+' '.join((q.get('text') or '')+' '.join(o['text'] for o in q.get('options') or []) for q in g['questions']) for g in s['groups']]:
            ww=nrm(txt)
            for i in range(len(ww)-5):
                if ' '.join(ww[i:i+6]) in sh: bad.append(f"S{s['part']} cambridge 6-gram: {' '.join(ww[i:i+6])}")
        for g in s['groups']:
            if g['type']=='gap' and not g.get('options'):
                for q in g['questions']:
                    if not any((' '+v+' ') in hay for a in q['answer'] for v in variants(a)): bad.append(f"Q{q['n']} answer {q['answer']} not verbatim")
                    for a in q['answer']:
                        if not limit_ok(g['wordLimit'],a): bad.append(f"Q{q['n']} {a} over limit")
            if g['type'] in('tfng','ynng','mcq') or (g['type']=='match' and g['questions'][0].get('text') and not g.get('title','').startswith('List of Head')):
                for q in g['questions']:
                    r=longest_run(q.get('text',''),ptxt)
                    if r>=6: bad.append(f"Q{q['n']} copies {r} words from passage")
                    for o in q.get('options') or []:
                        r=longest_run(o['text'],ptxt)
                        if r>=6: bad.append(f"Q{q['n']}{o['key']} option copies {r} words")
            if g['type'] in('tfng','ynng'):
                c=collections.Counter(q['answer'][0] for q in g['questions']);print('    ',g['from'],g['type'],dict(c))
            if g['type']=='mcq':
                for q in g['questions']:
                    L=[len(o['text']) for o in q['options']];key=[o for o in q['options'] if o['key']==q['answer'][0]][0]
                    if len(key['text'])==max(L): print('     mcq',q['n'],'key is longest')
            allq+= [ (q['n'],q['answer'][0]) for q in g['questions'] if g['type']=='mcq']
    print('  mcq keys',[a for _,a in allq])
    for b in bad: print('  BAD',b)
    return not bad
if __name__=='__main__':
    for f in sys.argv[1:]:
        print(f);check(f)
