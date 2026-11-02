import cv2,numpy as np
im=cv2.imread('../template_src.jpg'); H,W=im.shape[:2]
g0=cv2.cvtColor(im,cv2.COLOR_BGR2GRAY)
shirt=cv2.imread('../shirtmask.png',0)
M=cv2.dilate(shirt,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(41,41)))
T=np.zeros_like(g0)
for (y0,y1,x0,x1) in [(1885,1985,880,1240),(2005,2095,870,1250),(2440,2612,300,575)]:
    T[y0:y1,x0:x1]=(g0[y0:y1,x0:x1]<215).astype(np.uint8)*255
T=cv2.dilate(T,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(11,11)))
out=cv2.inpaint(im,T,9,cv2.INPAINT_TELEA)
g=cv2.cvtColor(out,cv2.COLOR_BGR2GRAY)
# thin-line pixel map (exclude blobs)
lm=((g<238)).astype(np.uint8)*255
thick=cv2.morphologyEx(lm,cv2.MORPH_OPEN,np.ones((7,7),np.uint8))
lm[cv2.dilate(thick,np.ones((7,7),np.uint8))>0]=0
# boundary points
Mo=cv2.dilate(M,np.ones((9,9),np.uint8))
cnts,_=cv2.findContours(Mo,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_NONE)
c=max(cnts,key=len)[:,0,:]
hits=[]
for i,(x,y) in enumerate(c):
    if lm[max(0,y-2):y+3,max(0,x-2):x+3].any(): hits.append(i)
groups=[];cur=[]
for i in hits:
    if cur and i-cur[-1]>6: groups.append(cur);cur=[]
    cur.append(i)
if cur: groups.append(cur)
bpts=[tuple(c[gg[len(gg)//2]]) for gg in groups if len(gg)<40]
# skip boundary pts near top of image region? keep all
print('boundary pts',len(bpts))
rng=np.random.default_rng(7)
ys,xs=np.where(M>0)
inner=[]
tries=0
while tries<4000 and len(inner)<30:
    tries+=1
    k=rng.integers(len(xs)); p=(int(xs[k]),int(ys[k]))
    if cv2.pointPolygonTest(c.reshape(-1,1,2).astype(np.int32),p,True)<70: continue
    if all(np.hypot(p[0]-q[0],p[1]-q[1])>195 for q in inner+bpts): inner.append(p)
print('inner',len(inner))
pts=bpts+inner
sub=cv2.Subdiv2D((0,0,W,H))
for p in pts: sub.insert((float(p[0]),float(p[1])))
edges=set()
idx={p:i for i,p in enumerate(pts)}
for t in sub.getTriangleList():
    tri=[(int(round(t[0])),int(round(t[1]))),(int(round(t[2])),int(round(t[3]))),(int(round(t[4])),int(round(t[5])))]
    if not all(q in idx for q in tri): continue
    for a,b in [(0,1),(1,2),(0,2)]:
        e=tuple(sorted((idx[tri[a]],idx[tri[b]]))); edges.add(e)
nb=len(bpts)
layer=np.full((H,W),255,np.uint8)
poly=c.reshape(-1,1,2).astype(np.int32)
kept=0
for a,b in edges:
    pa,pb=np.array(pts[a]),np.array(pts[b]); L=np.hypot(*(pa-pb))
    if a<nb and b<nb: continue # boundary-boundary skip
    if L>480: continue
    mid=(pa+pb)/2
    if cv2.pointPolygonTest(poly,(float(mid[0]),float(mid[1])),False)<0: continue
    if rng.random()<0.22: continue
    cv2.line(layer,tuple(int(v*16) for v in pa),tuple(int(v*16) for v in pb),214,2,cv2.LINE_AA,shift=4); kept+=1
print('edges',kept)
for i,p in enumerate(pts):
    if i<nb: r=int(rng.choice([5,7]))
    else: r=int(rng.choice([8,12,18,26]))
    cv2.circle(layer,p,r,int(rng.choice([226,232,238])),-1,cv2.LINE_AA)
inside=M>0
res=out.copy()
res[inside]=255
lay3=cv2.cvtColor(layer,cv2.COLOR_GRAY2BGR)
res=np.where(inside[...,None],np.minimum(res,lay3),res)
# feather seam
f=cv2.GaussianBlur((M>0).astype(np.float32),(0,0),3)[...,None]
res=(out*(1-f)+res*f).astype(np.uint8)
cv2.imwrite('template_clean.png',res)
cv2.imwrite('prev.jpg',cv2.resize(res,None,fx=0.33,fy=0.33))
cv2.imwrite('prev_zoom.jpg',cv2.resize(res[900:2700,250:1900],None,fx=0.45,fy=0.45))
