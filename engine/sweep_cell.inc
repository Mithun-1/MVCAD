// Trace the same piecewise-linear contours on all six cube faces, then fill
// their loops directly. Keeping face-diagonal vertices makes these patches
// conform exactly to the tetrahedra used at Boolean intersections and caps.
int polygonize_cell(const int* ids,int source,int group){
  auto& cache=cell_sources[source];
  const int edges[18][2]={{0,1},{1,2},{2,3},{3,0},{4,5},{5,6},{6,7},{7,4},{0,4},{1,5},{2,6},{3,7},{0,2},{4,6},{0,5},{3,6},{0,7},{1,6}};
  const int faces[6][4]={{0,1,2,3},{4,5,6,7},{0,9,4,8},{2,10,6,11},{3,11,7,8},{1,10,5,9}};
  Vertex points[18];int neighbor[18][2],degree[18]={};bool crossed[18]={},visited[18]={};
  double direction[3]={};
  for(int e=0;e<18;e++){
    int a=edges[e][0],b=edges[e][1];if((cache.values[a]<0)==(cache.values[b]<0))continue;
    crossed[e]=true;double t=cache.values[a]/(cache.values[a]-cache.values[b]);
    for(int k=0;k<2;k++){int v=k?b:a;if(!(cache.normal_mask&(1<<v))){gradient(group,ids[v],cache.normals[v]);cache.normal_mask|=1<<v;}}
    for(int c=0;c<3;c++){
      points[e].p[c]=cell_positions[a][c]+t*(cell_positions[b][c]-cell_positions[a][c]);
      points[e].n[c]=cache.normals[a][c]+t*(cache.normals[b][c]-cache.normals[a][c]);direction[c]+=points[e].n[c];
    }
  }
  for(int f=0;f<6;f++)for(int half=0;half<2;half++){
    int triangle_edges[3]={faces[f][half*2],faces[f][half*2+1],12+f},ends[2],n=0;
    for(int e:triangle_edges)if(crossed[e]){if(n==2)return 0;ends[n++]=e;}
    if(n==0)continue;if(n!=2||degree[ends[0]]==2||degree[ends[1]]==2)return 0;
    neighbor[ends[0]][degree[ends[0]]++]=ends[1];neighbor[ends[1]][degree[ends[1]]++]=ends[0];
  }
  int axis=0;for(int c=1;c<3;c++)if(__builtin_fabs(direction[c])>__builtin_fabs(direction[axis]))axis=c;
  int x=(axis+1)%3,y=(axis+2)%3;
  auto cross=[&](int a,int b,int c){return (points[b].p[x]-points[a].p[x])*(points[c].p[y]-points[a].p[y])-(points[b].p[y]-points[a].p[y])*(points[c].p[x]-points[a].p[x]);};
  int triangles[54],count=0;
  for(int first=0;first<18;first++)if(crossed[first]&&!visited[first]){
    int polygon[18],size=0,previous=-1,at=first;
    do{
      if(size==18||degree[at]!=2||visited[at])return 0;
      polygon[size++]=at;visited[at]=true;int next=neighbor[at][0]==previous?neighbor[at][1]:neighbor[at][0];previous=at;at=next;
    }while(at!=first);
    if(size<3)return 0;
    double area=0;for(int i=0;i<size;i++)area+=points[polygon[i]].p[x]*points[polygon[(i+1)%size]].p[y]-points[polygon[i]].p[y]*points[polygon[(i+1)%size]].p[x];
    double sign=area<0?-1:1;
    while(size>3){
      bool clipped=false;
      for(int i=0;i<size;i++){
        int a=polygon[(i+size-1)%size],b=polygon[i],c=polygon[(i+1)%size];
        if(cross(a,b,c)*sign<=h*h*1e-14)continue;
        bool contains=false;
        for(int j=0;j<size;j++){int p=polygon[j];if(p==a||p==b||p==c)continue;if(cross(a,b,p)*sign>=-h*h*1e-14&&cross(b,c,p)*sign>=-h*h*1e-14&&cross(c,a,p)*sign>=-h*h*1e-14){contains=true;break;}}
        if(contains)continue;
        bool reverse=sign*direction[axis]<0;triangles[count++]=reverse?c:a;triangles[count++]=b;triangles[count++]=reverse?a:c;
        for(int j=i;j+1<size;j++)polygon[j]=polygon[j+1];size--;clipped=true;break;
      }
      if(!clipped)return 0;
    }
    for(int j=0;j<3;j++)triangles[count++]=polygon[sign*direction[axis]<0?2-j:j];
  }
  for(int i=0;i<count;i+=3){
    const double *a=points[triangles[i]].p,*b=points[triangles[i+1]].p,*c=points[triangles[i+2]].p;double n[3],length2=0,dot=0;
    for(int j=0;j<3;j++){int u=(j+1)%3,v=(j+2)%3;n[j]=(b[u]-a[u])*(c[v]-a[v])-(b[v]-a[v])*(c[u]-a[u]);length2+=n[j]*n[j];dot+=n[j]*direction[j];}
    if(length2<h*h*h*h*1e-20||dot<=__builtin_sqrt(length2*(direction[0]*direction[0]+direction[1]*direction[1]+direction[2]*direction[2]))*1e-4)return 0;
  }
  for(int i=0;i<count;i+=3)if(!triangle(points[triangles[i]],points[triangles[i+1]],points[triangles[i+2]],direction,group))return -1;
  return 1;
}

