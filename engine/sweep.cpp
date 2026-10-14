// Implicit circular sweeps and solid union. Loaded only when Auto Sweep is enabled.
// Clip each source surface against the other sweeps inside each tetrahedron.
// Intersections are shared crease edges, never a face interpolated across two sources.
namespace {
constexpr int max_grid = 12000000, max_segments = 200000, max_vertices = 3000000;
double settings[8], segments[max_segments * 10], roundings[8192 * 7];
float field[max_grid], local_field[max_grid], normals[max_vertices * 3];
double vertices[max_vertices * 3];
unsigned sources[max_vertices / 3], cap_ids[max_vertices / 3];
int owners[max_grid], starts[max_segments], ends[max_segments], groups, base_groups;
int candidates[max_segments];
double boxes[max_segments * 6];
int nx, ny, nz, total, output, slice_first, slice_last;
double h, origin[3];
struct SegmentData {double d[3],inverse_length2,dr;};SegmentData segment_data[max_segments];
struct EndPlane {double center[3],normal[3],radius2,offset;int low[3],high[3];bool closed,external;};EndPlane end_planes[max_segments][2];

struct SearchNode {double low[3],high[3],radius;int begin,end,left,right;};
SearchNode search_nodes[max_segments*2];int search_roots[max_segments],search_count;
constexpr int cache_capacity=32000000;
float source_cache[cache_capacity];
struct CacheBox {int low[3],size[3],offset;};
CacheBox cache_boxes[max_segments];int cache_used;

double min(double a,double b){return a<b?a:b;}
double max(double a,double b){return a>b?a:b;}
int clamp(int n,int high){return n<0?0:n>high?high:n;}
void position(int id,double* p){p[0]=origin[0]+(id%nx)*h;p[1]=origin[1]+((id/nx)%ny)*h;p[2]=origin[2]+(id/(nx*ny))*h;}
double regular(double value){return __builtin_fabs(value)<h*1e-6?h*1e-6:value;}

void prepare_ends(int group){
  int begin=starts[group],end=ends[group];bool closed=true;
  for(int c=0;c<3;c++)if(segments[begin*10+c]!=segments[(end-1)*10+4+c])closed=false;
  for(int side=0;side<2;side++){
    int index=side?end-1:begin,base=side?4:0;double* s=segments+index*10;auto& cap=end_planes[group][side];
    double inverse_length=__builtin_sqrt(segment_data[index].inverse_length2),reach=s[base+3]*2;
    cap.closed=closed;cap.radius2=reach*reach;cap.external=!closed&&(int(s[9])&(side?32:16));cap.offset=(int(s[9])&(side?8:4))?h*.001:0;
    for(int c=0;c<3;c++){
      cap.center[c]=s[base+c];cap.normal[c]=(side?1:-1)*segment_data[index].d[c]*inverse_length;
      int n=c==0?nx:c==1?ny:nz;cap.low[c]=clamp(int((cap.center[c]-reach-origin[c])/h)-1,n-1);cap.high[c]=clamp(int((cap.center[c]+reach-origin[c])/h)+1,n-1);
    }
  }
}
bool near_cap_cell(int group,int x,int y,int z){
  int paths[2]={group,-1};if(group>=base_groups){paths[0]=int(roundings[(group-base_groups)*7]);paths[1]=int(roundings[(group-base_groups)*7+1]);}
  for(int path:paths){if(path<0)continue;for(const auto& cap:end_planes[path])if(cap.external&&x>=cap.low[0]&&x<=cap.high[0]&&y>=cap.low[1]&&y<=cap.high[1]&&z>=cap.low[2]&&z<=cap.high[2])return true;}
  return false;
}
int build_search(int begin,int end){
  int id=search_count++;SearchNode& node=search_nodes[id];node.begin=begin;node.end=end;node.radius=0;
  for(int c=0;c<3;c++){node.low[c]=1e30;node.high[c]=-1e30;}
  for(int i=begin;i<end;i++){
    double* s=segments+i*10;node.radius=max(node.radius,max(s[3],s[7]));
    for(int c=0;c<3;c++){
      double a=s[c],b=s[c+4],d=b-a,length=__builtin_sqrt((s[4]-s[0])*(s[4]-s[0])+(s[5]-s[1])*(s[5]-s[1])+(s[6]-s[2])*(s[6]-s[2]));
      if(int(s[9])&16)a-=d/length*s[3]*3;
      if(int(s[9])&32)b+=d/length*s[7]*3;
      node.low[c]=min(node.low[c],min(a,b));node.high[c]=max(node.high[c],max(a,b));
    }
  }
  if(end-begin>4){int middle=(begin+end)/2;node.left=build_search(begin,middle);node.right=build_search(middle,end);}else node.left=node.right=-1;
  return id;
}
double lower_bound(int id,const double* p){
  const SearchNode& node=search_nodes[id];double d2=0;for(int c=0;c<3;c++){double d=max(0,max(node.low[c]-p[c],p[c]-node.high[c]));d2+=d*d;}return __builtin_sqrt(d2)-node.radius;
}
void search_path(int id,int begin,int end,const double* p,int skip_caps,float& value,int& winner,double* normal){
  const SearchNode& node=search_nodes[id];
  if(node.left>=0){
    int a=node.left,b=node.right;double da=lower_bound(a,p),db=lower_bound(b,p);
    if(db<da){int t=a;a=b;b=t;double d=da;da=db;db=d;}
    if(float(da)<=value)search_path(a,begin,end,p,skip_caps,value,winner,normal);
    if(float(db)<=value)search_path(b,begin,end,p,skip_caps,value,winner,normal);
    return;
  }
  for(int i=node.begin;i<node.end;i++){
    double* s=segments+i*10;const auto& data=segment_data[i];const double* d=data.d;double q[3],dot=0,dist=0;
    for(int c=0;c<3;c++){q[c]=p[c]-s[c];dot+=q[c]*d[c];}
    double along=dot*data.inverse_length2,t=max(0,min(1,along));
    if((i==begin&&(skip_caps&1)&&along<0)||(i==end-1&&(skip_caps&2)&&along>1))t=along;
    for(int c=0;c<3;c++){double v=q[c]-t*d[c];dist+=v*v;}
    double length=__builtin_sqrt(dist),candidate=length-(s[3]+max(0,min(1,t))*(s[7]-s[3]));
    if(float(candidate)<value||(float(candidate)==value&&i<winner)){
      value=float(candidate);winner=i;
      if(normal)for(int c=0;c<3;c++)normal[c]=(q[c]-t*d[c])/max(length,1e-20)-(t>0&&t<1?data.dr*d[c]*data.inverse_length2:0);
    }
  }
}
void allocate_cache(int group){
  CacheBox& box=cache_boxes[group];long long size=1;
  for(int c=0;c<3;c++){int n=c==0?nx:c==1?ny:nz;box.low[c]=clamp(int((boxes[group*6+c]-origin[c])/h)-2,n-1);int high=clamp(int((boxes[group*6+c+3]-origin[c])/h)+3,n-1);box.size[c]=high-box.low[c]+1;size*=box.size[c];}
  box.offset=-1;if(size>cache_capacity-cache_used)return;box.offset=cache_used;cache_used+=int(size);
  for(int i=box.offset;i<cache_used;i++)source_cache[i]=1e30f;
}

double sample_path(int group,const double* p,double* normal=nullptr,int skip_caps=0){
  float value=1e20f;
  int begin=starts[group],end=ends[group];
  int winner=max_segments;search_path(search_roots[group],begin,end,p,skip_caps,value,winner,normal);
  for(int side=0;side<2;side++){
    const auto& cap=end_planes[group][side];if(cap.closed||(skip_caps&(1<<side)))continue;
    double dist2=0,plane=-cap.offset;
    for(int c=0;c<3;c++){double q=p[c]-cap.center[c];dist2+=q*q;plane+=q*cap.normal[c];}
    if(dist2<cap.radius2&&plane>value){value=float(plane);if(normal)for(int c=0;c<3;c++)normal[c]=cap.normal[c];}
  }
  return regular(value);
}
double sample(int group,const double* p){
  if(group<base_groups)return sample_path(group,p);
  const double* spec=roundings+(group-base_groups)*7;
  double ga[3],gb[3],a=sample_path(int(spec[0]),p,ga),b=sample_path(int(spec[1]),p,gb);
  double distance2=0,dot=0,la=0,lb=0;
  for(int c=0;c<3;c++){double d=p[c]-spec[c+2];distance2+=d*d;dot+=ga[c]*gb[c];la+=ga[c]*ga[c];lb+=gb[c]*gb[c];}
  double t=max(0,min(1,(__builtin_sqrt(distance2)/spec[6]-0.6)/0.4));
  double radius=spec[5]*(1-t*t*(3-2*t));
  double cosine=dot/max(__builtin_sqrt(la*lb),1e-20);
  if(radius<h*1e-6||cosine>0.999||cosine<-0.999)return max(a,b);
  // Rolling-circle arc in the local surface-normal plane. Radius is diameter / 2.
  // The metric accounts for the angle between the two vessel walls.
  double u=radius-a,v=radius-b,k=radius*(1-cosine);
  double arc=radius-__builtin_sqrt(max(0,(u*u+v*v-2*cosine*u*v)/(1-cosine*cosine)));
  // Keep the arc facing the intersection; the opposite circle arc is not a fillet.
  return regular(float(max(arc,max(max(a-k,b-k),max(cosine*v-u,cosine*u-v)))));
}

void rounding_normal(int group,const double* p,double* normal){
  const double* spec=roundings+(group-base_groups)*7;
  double ga[3],gb[3],a=sample_path(int(spec[0]),p,ga),b=sample_path(int(spec[1]),p,gb);
  double distance2=0,dot=0,la=0,lb=0;
  for(int c=0;c<3;c++){double d=p[c]-spec[c+2];distance2+=d*d;dot+=ga[c]*gb[c];la+=ga[c]*ga[c];lb+=gb[c]*gb[c];}
  double cosine=dot/max(__builtin_sqrt(la*lb),1e-20);
  if(cosine>0.999||cosine<-0.999)return;
  double t=max(0,min(1,(__builtin_sqrt(distance2)/spec[6]-0.6)/0.4));
  double radius=spec[5]*(1-t*t*(3-2*t)),u=radius-a,v=radius-b;
  // Evaluate the rolling-circle normal at the actual surface vertex. Grid
  // gradients straddle tangent joins and leave a visible faceted shading band.
  double wa=max(0,u-cosine*v),wb=max(0,v-cosine*u);
  if(wa+wb<1e-15)return;
  for(int c=0;c<3;c++)normal[c]=wa*ga[c]/max(__builtin_sqrt(la),1e-20)+wb*gb[c]/max(__builtin_sqrt(lb),1e-20);
}
double value_at(int group,int id){
  if(owners[id]==group)return field[id];
  const CacheBox& box=cache_boxes[group];int x=id%nx-box.low[0],y=(id/nx)%ny-box.low[1],z=id/(nx*ny)-box.low[2];
  int offset=box.offset>=0&&x>=0&&x<box.size[0]&&y>=0&&y<box.size[1]&&z>=0&&z<box.size[2]?box.offset+(z*box.size[1]+y)*box.size[0]+x:-1;
  if(offset>=0&&source_cache[offset]!=1e30f)return source_cache[offset];
  double p[3];position(id,p);double value=sample(group,p);if(offset>=0)source_cache[offset]=float(value);return value;
}
void gradient(int group,int id,double* g){
  int coord[3]={id%nx,(id/nx)%ny,id/(nx*ny)},dims[3]={nx,ny,nz},stride[3]={1,nx,nx*ny};
  for(int c=0;c<3;c++)g[c]=value_at(group,id+(coord[c]<dims[c]-1?stride[c]:0))-value_at(group,id-(coord[c]>0?stride[c]:0));
}
struct Vertex { double p[3],n[3],w[4]; };
Vertex mix(const Vertex& a,const Vertex& b,double t){
  Vertex v;for(int c=0;c<3;c++){v.p[c]=a.p[c]+t*(b.p[c]-a.p[c]);v.n[c]=a.n[c]+t*(b.n[c]-a.n[c]);}
  for(int c=0;c<4;c++)v.w[c]=a.w[c]+t*(b.w[c]-a.w[c]);return v;
}
bool triangle(const Vertex& a,const Vertex& b,const Vertex& c,const double* outward,int group,unsigned cap_id=0){
  if(output+3>max_vertices)return false;
  double u[3],v[3];for(int j=0;j<3;j++){u[j]=b.p[j]-a.p[j];v[j]=c.p[j]-a.p[j];}
  double dot=(u[1]*v[2]-u[2]*v[1])*outward[0]+(u[2]*v[0]-u[0]*v[2])*outward[1]+(u[0]*v[1]-u[1]*v[0])*outward[2];

  double area2=0;for(int j=0;j<3;j++){double cross=u[(j+1)%3]*v[(j+2)%3]-u[(j+2)%3]*v[(j+1)%3];area2+=cross*cross;}
  if(area2<h*h*h*h*1e-24)return true;
  sources[output/3]=group;cap_ids[output/3]=cap_id;
  const Vertex* vs[3]={&a,dot<0?&c:&b,dot<0?&b:&c};
  for(const Vertex* p:vs){double n[3]={p->n[0],p->n[1],p->n[2]};if(!cap_id&&group>=base_groups)rounding_normal(group,p->p,n);double length=__builtin_sqrt(n[0]*n[0]+n[1]*n[1]+n[2]*n[2]);for(int j=0;j<3;j++){vertices[output*3+j]=p->p[j]-origin[j];normals[output*3+j]=float(n[j]/max(length,1e-20));}output++;}return true;
}
bool tetra_legacy(const int* ids,const int* candidates,int count){
  for(int source=0;source<count;source++){
    int group=candidates[source],inside[4],outside[4],ni=0,no=0;double f[4],a[3]={},b[3]={};Vertex corners[4];
    for(int j=0;j<4;j++){
      position(ids[j],corners[j].p);f[j]=value_at(group,ids[j]);
      for(int k=0;k<4;k++)corners[j].w[k]=j==k?1:0;
      if(f[j]<0){inside[ni++]=j;for(int c=0;c<3;c++)a[c]+=corners[j].p[c];}
      else{outside[no++]=j;for(int c=0;c<3;c++)b[c]+=corners[j].p[c];}
    }
    if(!ni||!no)continue;
    for(int j=0;j<4;j++)gradient(group,ids[j],corners[j].n);
    double direction[3];for(int c=0;c<3;c++)direction[c]=b[c]/no-a[c]/ni;
    auto edge=[&](int i,int j){return mix(corners[i],corners[j],f[i]/(f[i]-f[j]));};
    Vertex polygon[256],next[256];int size=0;
    if(ni==1){for(int j=0;j<3;j++)polygon[size++]=edge(inside[0],outside[j]);}
    else if(no==1){for(int j=0;j<3;j++)polygon[size++]=edge(outside[0],inside[j]);}
    else{polygon[size++]=edge(inside[0],outside[0]);polygon[size++]=edge(inside[0],outside[1]);polygon[size++]=edge(inside[1],outside[1]);polygon[size++]=edge(inside[1],outside[0]);}
    for(int other=0;other<count&&size;other++){
      if(other==source)continue;double clip[4];for(int j=0;j<4;j++)clip[j]=value_at(candidates[other],ids[j]);
      auto at=[&](const Vertex& v){double sum=0;for(int j=0;j<4;j++)sum+=v.w[j]*clip[j];return __builtin_fabs(sum)<h*1e-10?0:sum;};
      bool coincident=true;for(int j=0;j<size;j++)if(__builtin_fabs(at(polygon[j]))>h*1e-10)coincident=false;
      if(coincident){if(candidates[other]<group)size=0;continue;}
      int n=0;
      for(int j=0;j<size;j++){
        const Vertex &p=polygon[j],&q=polygon[(j+1)%size];double fp=at(p),fq=at(q);
        if(fp>=0)next[n++]=p;
        if((fp<0)!=(fq<0))next[n++]=mix(p,q,fp/(fp-fq));
        if(n>250)return false;
      }
      size=n;for(int j=0;j<size;j++)polygon[j]=next[j];
    }
    for(int j=1;j+1<size;j++)if(!triangle(polygon[0],polygon[j],polygon[j+1],direction,group))return false;
  }
  return true;
}
struct CellSource {double values[8],normals[8][3];unsigned mask,normal_mask;};
CellSource cell_sources[512];double cell_positions[8][3];
bool tetra_fast(const int* ids,const int* local,const int* candidates,int count){
  for(int source=0;source<count;source++){
    if(cell_sources[source].mask==0||cell_sources[source].mask==255)continue;
    int group=candidates[source],inside[4],outside[4],ni=0,no=0;double f[4],a[3]={},b[3]={};Vertex corners[4];
    for(int j=0;j<4;j++){
      for(int c=0;c<3;c++)corners[j].p[c]=cell_positions[local[j]][c];f[j]=cell_sources[source].values[local[j]];
      for(int k=0;k<4;k++)corners[j].w[k]=j==k?1:0;
      if(f[j]<0){inside[ni++]=j;for(int c=0;c<3;c++)a[c]+=corners[j].p[c];}
      else{outside[no++]=j;for(int c=0;c<3;c++)b[c]+=corners[j].p[c];}
    }
    if(!ni||!no)continue;
    for(int j=0;j<4;j++){
      auto& cache=cell_sources[source];int at=local[j];if(!(cache.normal_mask&(1<<at))){gradient(group,ids[j],cache.normals[at]);cache.normal_mask|=1<<at;}
      for(int c=0;c<3;c++)corners[j].n[c]=cache.normals[at][c];
    }
    double direction[3];for(int c=0;c<3;c++)direction[c]=b[c]/no-a[c]/ni;
    auto edge=[&](int i,int j){return mix(corners[i],corners[j],f[i]/(f[i]-f[j]));};
    Vertex polygon[256],next[256];int size=0;
    if(ni==1){for(int j=0;j<3;j++)polygon[size++]=edge(inside[0],outside[j]);}
    else if(no==1){for(int j=0;j<3;j++)polygon[size++]=edge(outside[0],inside[j]);}
    else{polygon[size++]=edge(inside[0],outside[0]);polygon[size++]=edge(inside[0],outside[1]);polygon[size++]=edge(inside[1],outside[1]);polygon[size++]=edge(inside[1],outside[0]);}
    for(int other=0;other<count&&size;other++){
      if(other==source||cell_sources[other].mask==0)continue;
      if(cell_sources[other].mask==255){size=0;break;}
      double clip[4];for(int j=0;j<4;j++)clip[j]=cell_sources[other].values[local[j]];
      auto at=[&](const Vertex& v){double sum=0;for(int j=0;j<4;j++)sum+=v.w[j]*clip[j];return __builtin_fabs(sum)<h*1e-10?0:sum;};
      bool coincident=true;for(int j=0;j<size;j++)if(__builtin_fabs(at(polygon[j]))>h*1e-10)coincident=false;
      if(coincident){if(candidates[other]<group)size=0;continue;}
      int n=0;
      for(int j=0;j<size;j++){
        const Vertex &p=polygon[j],&q=polygon[(j+1)%size];double fp=at(p),fq=at(q);
        if(fp>=0)next[n++]=p;
        if((fp<0)!=(fq<0))next[n++]=mix(p,q,fp/(fp-fq));
        if(n>250)return false;
      }
      size=n;for(int j=0;j<size;j++)polygon[j]=next[j];
    }
    for(int j=1;j+1<size;j++)if(!triangle(polygon[0],polygon[j],polygon[j+1],direction,group))return false;
  }
  return true;
}
#include "sweep_cell.inc"
// Boundary planes are independent constraints, rather than a max() blended
// into the sampled wall field. Their intersection is an exact, shared rim.
struct Constraint {double f[4],normal[3];unsigned cap;};
struct Solid {Constraint faces[5];int count,skip;};
Solid constraints(int group,const int* ids,bool values=true){
  Solid result{};result.count=1;
  int paths[2]={group,-1};
  if(group>=base_groups){const double* r=roundings+(group-base_groups)*7;paths[0]=int(r[0]);paths[1]=int(r[1]);}
  for(int path:paths){
    if(path<0)continue;
    for(int end=0;end<2;end++){
      double* segment=segments+(end?ends[path]-1:starts[path])*10;
      if(!(int(segment[9])&(end?32:16)))continue;
      int base=end?4:0;double length2=0,nearest=1e30;
      for(int c=0;c<3;c++){double d=segment[c+4]-segment[c];length2+=d*d;}
      for(int j=0;j<4;j++){double p[3],distance2=0;position(ids[j],p);for(int c=0;c<3;c++){double d=p[c]-segment[base+c];distance2+=d*d;}nearest=min(nearest,distance2);}
      double reach=2*segment[base+3];if(nearest>reach*reach)continue;
      Constraint& cap=result.faces[result.count++];cap.cap=path*2+end+1;
      for(int c=0;c<3;c++)cap.normal[c]=(end?1:-1)*(segment[c+4]-segment[c])/__builtin_sqrt(length2);
      for(int j=0;j<4;j++){double p[3];position(ids[j],p);cap.f[j]=0;for(int c=0;c<3;c++)cap.f[j]+=(p[c]-segment[base+c])*cap.normal[c];}
      if(group<base_groups)result.skip|=1<<end;
    }
  }
  if(values)for(int j=0;j<4;j++){
    double p[3];position(ids[j],p);
    result.faces[0].f[j]=result.skip?sample_path(group,p,nullptr,result.skip):value_at(group,ids[j]);
  }
  return result;
}
double constraint_value(const Constraint& plane,const Vertex& vertex){
  double value=0;for(int j=0;j<4;j++)value+=plane.f[j]*vertex.w[j];
  return __builtin_fabs(value)<h*1e-10?0:value;
}
int clip_polygon(const Vertex* polygon,int size,Vertex* result,const Constraint& plane,bool outside){
  int n=0;
  for(int j=0;j<size;j++){
    const Vertex &p=polygon[j],&q=polygon[(j+1)%size];
    double fp=constraint_value(plane,p)*(outside?1:-1),fq=constraint_value(plane,q)*(outside?1:-1);
    if(fp>=0)result[n++]=p;
    if((fp<0)!=(fq<0))result[n++]=mix(p,q,fp/(fp-fq));
    if(n>250)return -1;
  }
  return n;
}
// Subtract a solid that is itself the intersection of wall and cap constraints.
// Disjoint outside pieces continue through the remaining union operands.
bool subtract_solids(const Vertex* polygon,int size,const int* ids,const int* candidates,int count,int other,int group,unsigned cap,const double* direction){
  if(size<3)return true;
  while(other<count&&candidates[other]==group)other++;
  if(other==count){for(int j=1;j+1<size;j++)if(!triangle(polygon[0],polygon[j],polygon[j+1],direction,group,cap))return false;return true;}
  Solid solid=constraints(candidates[other],ids);
  Vertex remaining[256],next[256],outside[256];for(int j=0;j<size;j++)remaining[j]=polygon[j];
  for(int face=0;face<solid.count&&size>=3;face++){
    const Constraint& plane=solid.faces[face];bool coincident=true;
    for(int j=0;j<size;j++)if(constraint_value(plane,remaining[j])!=0)coincident=false;
    if(coincident){
      if(candidates[other]>group)return subtract_solids(remaining,size,ids,candidates,count,other+1,group,cap,direction);
      continue;
    }
    int n=clip_polygon(remaining,size,outside,plane,true);if(n<0)return false;
    if(!subtract_solids(outside,n,ids,candidates,count,other+1,group,cap,direction))return false;
    n=clip_polygon(remaining,size,next,plane,false);if(n<0)return false;
    size=n;for(int j=0;j<size;j++)remaining[j]=next[j];
  }
  return true;
}
bool tetra(const int* ids,const int* candidates,int count){
  bool explicit_caps=false;
  for(int source=0;source<count;source++)if(constraints(candidates[source],ids,false).count>1){explicit_caps=true;break;}
  if(!explicit_caps)return tetra_legacy(ids,candidates,count);
  // Bound recursive Boolean clipping to the dedicated sweep stack budget.
  if(count>64)return false;
  for(int source=0;source<count;source++){
    int group=candidates[source];Solid solid=constraints(group,ids);
    for(int face=0;face<solid.count;face++){
      const Constraint& surface=solid.faces[face];int inside[4],outside[4],ni=0,no=0;double a[3]={},b[3]={};Vertex corners[4];
      for(int j=0;j<4;j++){
        position(ids[j],corners[j].p);for(int k=0;k<4;k++)corners[j].w[k]=j==k?1:0;
        if(surface.f[j]<0){inside[ni++]=j;for(int c=0;c<3;c++)a[c]+=corners[j].p[c];}
        else{outside[no++]=j;for(int c=0;c<3;c++)b[c]+=corners[j].p[c];}
        if(surface.cap){for(int c=0;c<3;c++)corners[j].n[c]=surface.normal[c];}
        else if(solid.skip)sample_path(group,corners[j].p,corners[j].n,solid.skip);
        else gradient(group,ids[j],corners[j].n);
      }
      if(!ni||!no)continue;
      double direction[3];for(int c=0;c<3;c++)direction[c]=b[c]/no-a[c]/ni;
      auto edge=[&](int i,int j){return mix(corners[i],corners[j],surface.f[i]/(surface.f[i]-surface.f[j]));};
      Vertex polygon[256],next[256];int size=0;
      if(ni==1){for(int j=0;j<3;j++)polygon[size++]=edge(inside[0],outside[j]);}
      else if(no==1){for(int j=0;j<3;j++)polygon[size++]=edge(outside[0],inside[j]);}
      else{polygon[size++]=edge(inside[0],outside[0]);polygon[size++]=edge(inside[0],outside[1]);polygon[size++]=edge(inside[1],outside[1]);polygon[size++]=edge(inside[1],outside[0]);}
      for(int clip=0;clip<solid.count&&size>=3;clip++)if(clip!=face){
        size=clip_polygon(polygon,size,next,solid.faces[clip],false);if(size<0)return false;
        for(int j=0;j<size;j++)polygon[j]=next[j];
      }
      if(!subtract_solids(polygon,size,ids,candidates,count,0,group,surface.cap,direction))return false;
    }
  }
  return true;
}

#include "sweep_mesh.inc"
}
extern "C" {
int begin_merge_sweep(int groups,int vertices){return begin_merge(groups,vertices);}
int merge_sweep_chunk(int unique,int rendered,int size,double lower,double upper){return merge_chunk(unique,rendered,size,lower,upper);}
int finish_merge_sweep(){return group_mesh(merge_unique,merge_rendered);}
unsigned* sweep_merge_indices(){return mesh_indices;}
unsigned* sweep_merge_render_indices(){return mesh_render_indices;}
unsigned* sweep_mesh_render_vertices(){return render_vertex;}
unsigned* sweep_mesh_counts(){return mesh_counts;}
unsigned* sweep_mesh_indices(){return mesh_grouped_indices;}
unsigned* sweep_mesh_render_indices(){return mesh_grouped_render;}
unsigned* sweep_mesh_sources(){return mesh_sources;}
unsigned* sweep_mesh_caps(){return mesh_caps;}
unsigned* sweep_mesh_ranges(){return mesh_ranges;}
float* sweep_mesh_normals(){return mesh_normals;}
float* sweep_mesh_render_positions(){return mesh_render_positions;}
int index_sweep(){return index_mesh();}
int finish_sweep(){return finish_mesh();}
float* sweep_mesh_creases(){return mesh_creases;}
unsigned* sweep_mesh_crease_ranges(){return mesh_crease_ranges;}
double* sweep_settings(){return settings;}
double* sweep_segments(){return segments;}
double* sweep_roundings(){return roundings;}
double* sweep_vertices(){return vertices;}
float* sweep_normals(){return normals;}
unsigned* sweep_sources(){return sources;}
unsigned* sweep_caps(){return cap_ids;}
float* sweep_field(){return field;}
int prepare_sweep(int count){
  if(count<1||count>max_segments)return -1;
  for(int i=0;i<8;i++)if(!__builtin_isfinite(settings[i]))return -1;
  h=settings[3];nx=int(settings[4]);ny=int(settings[5]);nz=int(settings[6]);
  if(h<=0||nx<3||ny<3||nz<3||double(nx)*ny*nz>max_grid)return -2;
  int rounding_count=int(settings[7]);
  if(rounding_count<0||rounding_count>8192||rounding_count!=settings[7])return -1;
  slice_first=0;slice_last=nz-1;
  total=nx*ny*nz;for(int c=0;c<3;c++)origin[c]=settings[c];
  double rounding_reach=0;for(int r=0;r<rounding_count;r++)rounding_reach=max(rounding_reach,roundings[r*7+5]*2);
  for(int i=0;i<count*10;i++)if(!__builtin_isfinite(segments[i]))return -1;
  for(int i=0;i<count;i++){
    double l2=0;auto& data=segment_data[i];double* s=segments+i*10;
    for(int c=0;c<3;c++){data.d[c]=s[c+4]-s[c];l2+=data.d[c]*data.d[c];}
    if(!__builtin_isfinite(l2)||l2<1e-24||s[3]<=0||s[7]<=0)return -1;
    data.inverse_length2=1/l2;data.dr=s[7]-s[3];
  }
  for(int i=0;i<total;i++){field[i]=1e20f;owners[i]=-1;}
  groups=0;search_count=0;cache_used=0;
  int begin=0;
  while(begin<count){
    int end=begin+1;while(end<count&&segments[end*10+8]==segments[begin*10+8])end++;
    starts[groups]=begin;ends[groups]=end;prepare_ends(groups);
    for(int c=0;c<3;c++){boxes[groups*6+c]=1e30;boxes[groups*6+c+3]=-1e30;}
    bool closed=true;for(int c=0;c<3;c++)if(segments[begin*10+c]!=segments[(end-1)*10+4+c])closed=false;
    for(int i=0;i<total;i++)local_field[i]=1e20f;
    for(int j=begin;j<end;j++){
      double* s=segments+j*10;double d[3],l2=0;for(int c=0;c<3;c++){d[c]=s[c+4]-s[c];l2+=d[c]*d[c];}
      if(!__builtin_isfinite(l2)||l2<1e-24||s[3]<=0||s[7]<=0)return -1;
      double radius=max(s[3],s[7])+max(h*2,rounding_reach);int lo[3],hi[3];
      for(int c=0;c<3;c++){boxes[groups*6+c]=min(boxes[groups*6+c],min(s[c],s[c+4])-radius);boxes[groups*6+c+3]=max(boxes[groups*6+c+3],max(s[c],s[c+4])+radius);}
      for(int c=0;c<3;c++){int n=c==0?nx:c==1?ny:nz;lo[c]=clamp(int((min(s[c],s[c+4])-radius-origin[c])/h)-1,n-1);hi[c]=clamp(int((max(s[c],s[c+4])+radius-origin[c])/h)+1,n-1);}
      for(int z=lo[2];z<=hi[2];z++)for(int y=lo[1];y<=hi[1];y++)for(int x=lo[0];x<=hi[0];x++){
        double p[3]={origin[0]+x*h-s[0],origin[1]+y*h-s[1],origin[2]+z*h-s[2]};
        double along=(p[0]*d[0]+p[1]*d[1]+p[2]*d[2])/l2,t=max(0,min(1,along)),dist=0;
        for(int c=0;c<3;c++){double q=p[c]-t*d[c];dist+=q*q;}
        double value=__builtin_sqrt(dist)-(s[3]+t*(s[7]-s[3]));
        int id=(z*ny+y)*nx+x;if(value<local_field[id])local_field[id]=float(value);
      }
    }
    for(int i=0;i<total;i++){
      if(local_field[i]<1e19f){
        double p[3];position(i,p);
        for(int cap=0;!closed&&cap<2;cap++){
          double* s=segments+(cap?end-1:begin)*10;int base=cap?4:0;
          double d[3],q[3],length2=0,dist2=0,projection=0;
          for(int c=0;c<3;c++){d[c]=s[c+4]-s[c];q[c]=p[c]-s[c+base];length2+=d[c]*d[c];dist2+=q[c]*q[c];projection+=q[c]*d[c];}
          double radius=s[base+3];
          double cap_value=(cap?projection:-projection)/__builtin_sqrt(length2);
          if(int(s[9])&(cap?8:4))cap_value-=h*0.001;
          if(dist2<radius*radius*4)local_field[i]=float(max(local_field[i],cap_value));
        }
      }
      // Base sweeps form a hard union; requested rounding sources are added below.
      if(local_field[i]<field[i]){field[i]=local_field[i];owners[i]=groups;}
    }
    search_roots[groups]=build_search(begin,end);allocate_cache(groups);
    begin=end;groups++;
  }
  base_groups=groups;
  if(base_groups+rounding_count>max_segments)return -1;
  for(int r=0;r<rounding_count;r++){
    double* spec=roundings+r*7;
    for(int i=0;i<7;i++)if(!__builtin_isfinite(spec[i]))return -1;
    if(spec[0]<0||spec[0]>=base_groups||spec[1]<0||spec[1]>=base_groups||spec[5]<=0||spec[6]<=0)return -1;
    int lo[3],hi[3];
    for(int c=0;c<3;c++){
      boxes[groups*6+c]=spec[c+2]-spec[6];boxes[groups*6+c+3]=spec[c+2]+spec[6];
      // A rolling-circle patch requires both wall distances to be below 2r.
      // Intersect conservative bounds for both guides before sampling its grid.
      for(int side=0;side<2;side++){
        const auto& guide=search_nodes[search_roots[int(spec[side])]];
        double margin=guide.radius+spec[5]*2+h*2;
        boxes[groups*6+c]=max(boxes[groups*6+c],guide.low[c]-margin);
        boxes[groups*6+c+3]=min(boxes[groups*6+c+3],guide.high[c]+margin);
      }
      int n=c==0?nx:c==1?ny:nz;
      lo[c]=clamp(int((boxes[groups*6+c]-origin[c])/h)-2,n-1);hi[c]=clamp(int((boxes[groups*6+c+3]-origin[c])/h)+2,n-1);
    }
    allocate_cache(groups);
    for(int z=lo[2];z<=hi[2];z++)for(int y=lo[1];y<=hi[1];y++)for(int x=lo[0];x<=hi[0];x++){
      int id=(z*ny+y)*nx+x;
      // A fillet adds material only outside the base union and within 2r of a wall.
      // Interior samples can be evaluated lazily if Boolean clipping needs them.
      if(field[id]<=0||field[id]>spec[5]*2)continue;
      float value=float(value_at(groups,id));
      if(value<field[id]){field[id]=value;owners[id]=groups;}
    }
    groups++;
  }
  // Avoid vertex-on-isosurface degeneracies while preserving a deterministic shared edge vertex.
  for(int i=0;i<total;i++)if(__builtin_fabs(field[i])<h*1e-6)field[i]=float(h*1e-6);
  return 0;
}
int polygonize_sweep(){
  output=0;const int pattern[6][4]={{0,5,1,6},{0,1,2,6},{0,2,3,6},{0,3,7,6},{0,7,4,6},{0,4,5,6}};
  for(int z=slice_first;z<slice_last;z++)for(int y=0;y<ny-1;y++)for(int x=0;x<nx-1;x++){
    int a=(z*ny+y)*nx+x,b=a+nx*ny;int ids[8]={a,a+1,a+nx+1,a+nx,b,b+1,b+nx+1,b+nx};
    int negative=0;for(int j=0;j<8;j++)negative+=field[ids[j]]<0;if(negative==0){double nearest=1e30;for(int j=0;j<8;j++)nearest=min(nearest,field[ids[j]]);if(nearest>h*2)continue;}
    bool same=true;for(int j=1;j<8;j++)if(owners[ids[j]]!=owners[a])same=false;
    if(negative==8&&same)continue;
    int n=0;double p[3];position(a,p);
    for(int g=0;g<groups;g++){bool overlaps=true;for(int c=0;c<3;c++)if(p[c]+h<boxes[g*6+c]||p[c]>boxes[g*6+c+3])overlaps=false;if(overlaps)candidates[n++]=g;}
    bool boundary=n>512;
    for(int i=0;i<n&&!boundary;i++)boundary=near_cap_cell(candidates[i],x,y,z);
    if(!boundary){
      for(int j=0;j<8;j++)position(ids[j],cell_positions[j]);
      for(int i=0;i<n;i++){auto& cache=cell_sources[i];cache.mask=cache.normal_mask=0;for(int j=0;j<8;j++){cache.values[j]=value_at(candidates[i],ids[j]);if(cache.values[j]<0)cache.mask|=1<<j;}}
    }
    if(!boundary){
      int source=-1;bool single=true;
      for(int i=0;i<n;i++)if(cell_sources[i].mask){if(cell_sources[i].mask==255){single=false;break;}if(source>=0){single=false;break;}source=i;}
      if(single&&source>=0&&candidates[source]<base_groups){int result=polygonize_cell(ids,source,candidates[source]);if(result<0)return -3;if(result>0)continue;}
    }
    for(auto &t:pattern){int v[4]={ids[t[0]],ids[t[1]],ids[t[2]],ids[t[3]]};if(!(boundary?tetra(v,candidates,n):tetra_fast(v,t,candidates,n)))return -3;}
  }
  return output;
}
int build_sweep(int count){int result=prepare_sweep(count);return result<0?result:polygonize_sweep();}
int build_sweep_slice(int count,int first,int last){
  int full=int(settings[6]);if(first<0||last>full-1||first>=last)return -1;
  int low=first>2?first-2:0,high=last+3<full?last+3:full;double shift=low*settings[3];
  settings[2]+=shift;settings[6]=high-low;
  int result=prepare_sweep(count);if(result<0)return result;
  slice_first=first-low;slice_last=last-low;result=polygonize_sweep();
  if(result>0)for(int i=0;i<result;i++)vertices[i*3+2]+=shift;
  return result;
}
int assemble_sweep(int count,int source_count){
  if(count<0||count>max_vertices||count%3||source_count<1||source_count>max_segments)return -3;
  output=count;base_groups=source_count;h=settings[3];for(int c=0;c<3;c++)origin[c]=settings[c];return 0;
}
}
