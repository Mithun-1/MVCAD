// Compact and index the triangle stream in native memory. The surface remains
// welded for topology, with separate display vertices across true creases.
constexpr int mesh_hash_capacity=1<<23;
unsigned weld_hash[mesh_hash_capacity],render_hash[mesh_hash_capacity];
unsigned mesh_indices[max_vertices],mesh_render_indices[max_vertices];
unsigned mesh_grouped_indices[max_vertices],mesh_grouped_render[max_vertices];
unsigned mesh_sources[max_vertices/3],mesh_caps[max_vertices/3];
unsigned render_vertex[max_vertices],render_source[max_vertices],render_cap[max_vertices];
unsigned mesh_parents[max_vertices+1],mesh_sizes[max_vertices],mesh_cursors[max_vertices];
unsigned mesh_ranges[max_vertices/3*2],mesh_counts[5];
float mesh_normals[max_vertices*3],mesh_render_positions[max_vertices*3];
union CoordinateScratch {double original[max_vertices*3];long long quantized[max_vertices*3];};
CoordinateScratch coordinate_scratch;
#define mesh_original coordinate_scratch.original
long long quantize(double value){return (long long)__builtin_floor(value/(h*1e-6)+0.5);}
unsigned hash_mix(unsigned v){v^=v>>16;v*=0x85ebca6bU;v^=v>>13;v*=0xc2b2ae35U;return v^(v>>16);}
unsigned coordinate_hash(long long x,long long y,long long z){return hash_mix(unsigned(x)*73856093U^unsigned(y)*19349663U^unsigned(z)*83492791U^unsigned(x>>32)^unsigned(y>>32)*31U^unsigned(z>>32)*961U);}
unsigned mesh_root(unsigned v){while(mesh_parents[v]!=v){mesh_parents[v]=mesh_parents[mesh_parents[v]];v=mesh_parents[v];}return v;}
bool grow_mesh_hash(unsigned& capacity,unsigned unique,unsigned rendered){
  if(capacity>=mesh_hash_capacity)return false;capacity*=2;unsigned mask=capacity-1;
  for(unsigned i=0;i<capacity;i++)weld_hash[i]=render_hash[i]=0;
  const long long* q=coordinate_scratch.quantized;
  for(unsigned v=0;v<unique;v++){unsigned slot=coordinate_hash(q[v*3],q[v*3+1],q[v*3+2])&mask;while(weld_hash[slot])slot=(slot+1)&mask;weld_hash[slot]=v+1;}
  for(unsigned r=0;r<rendered;r++){unsigned slot=hash_mix(render_vertex[r]*73856093U^render_source[r]*19349663U^render_cap[r]*83492791U)&mask;while(render_hash[slot])slot=(slot+1)&mask;render_hash[slot]=r+1;}
  return true;
}
int group_mesh(unsigned unique,unsigned rendered);
int index_mesh(){
  unsigned capacity=1024;while(capacity<unsigned(output)/2)capacity*=2;
  if(capacity>mesh_hash_capacity)return -1;
  for(unsigned i=0;i<capacity;i++)weld_hash[i]=render_hash[i]=0;
  unsigned unique=0,rendered=0,mask=capacity-1;
  long long* quantized=coordinate_scratch.quantized;
  for(int i=0;i<output;i++){
    if(unique*2>=capacity||rendered*2>=capacity){if(!grow_mesh_hash(capacity,unique,rendered))return -1;mask=capacity-1;}
    const double* p=vertices+i*3;
    long long x=quantize(p[0]),y=quantize(p[1]),z=quantize(p[2]);
    unsigned slot=coordinate_hash(x,y,z)&mask,v;
    while(weld_hash[slot]){
      v=weld_hash[slot]-1;
      if(quantized[v*3]==x&&quantized[v*3+1]==y&&quantized[v*3+2]==z)break;
      slot=(slot+1)&mask;
    }
    if(!weld_hash[slot]){
      v=unique++;weld_hash[slot]=v+1;mesh_parents[v]=v;mesh_sizes[v]=0;quantized[v*3]=x;quantized[v*3+1]=y;quantized[v*3+2]=z;
      for(int c=0;c<3;c++){vertices[v*3+c]=p[c];mesh_normals[v*3+c]=normals[i*3+c];}
    }
    mesh_indices[i]=v;
    unsigned source=sources[i/3],cap=cap_ids[i/3];
    slot=hash_mix(v*73856093U^source*19349663U^cap*83492791U)&mask;
    unsigned r;
    while(render_hash[slot]){
      r=render_hash[slot]-1;
      if(render_vertex[r]==v&&render_source[r]==source&&render_cap[r]==cap)break;
      slot=(slot+1)&mask;
    }
    if(!render_hash[slot]){
      r=rendered++;render_hash[slot]=r+1;render_vertex[r]=v;render_source[r]=source;render_cap[r]=cap;
      for(int c=0;c<3;c++){mesh_render_positions[r*3+c]=float(vertices[v*3+c]);normals[r*3+c]=normals[i*3+c];}
    }
    mesh_render_indices[i]=r;
  }
  return group_mesh(unique,rendered);
}
int group_mesh(unsigned unique,unsigned rendered){
  for(int i=0;i<output;i+=3){unsigned a=mesh_indices[i],b=mesh_indices[i+1],c=mesh_indices[i+2];mesh_parents[mesh_root(b)]=mesh_root(a);mesh_parents[mesh_root(c)]=mesh_root(a);}
  for(int i=0;i<output;i+=3){unsigned a=mesh_indices[i],b=mesh_indices[i+1],c=mesh_indices[i+2];if(a==b||a==c||b==c)continue;mesh_sizes[mesh_root(a)]+=3;}
  // Preserve component ordering by first appearance in the triangle stream.
  unsigned bodies=0,size=0;
  for(int i=0;i<output;i+=3){unsigned a=mesh_indices[i],b=mesh_indices[i+1],c=mesh_indices[i+2];if(a==b||a==c||b==c)continue;unsigned root=mesh_root(a);if(!mesh_sizes[root])continue;
    mesh_ranges[bodies*2]=size;mesh_ranges[bodies*2+1]=mesh_sizes[root];mesh_cursors[root]=size;size+=mesh_sizes[root];mesh_sizes[root]=0;bodies++;
  }
  for(int i=0;i<output;i+=3){unsigned a=mesh_indices[i],b=mesh_indices[i+1],c=mesh_indices[i+2];if(a==b||a==c||b==c)continue;unsigned root=mesh_root(a),cursor=mesh_cursors[root];mesh_cursors[root]+=3;
    for(int j=0;j<3;j++){mesh_grouped_indices[cursor+j]=mesh_indices[i+j];mesh_grouped_render[cursor+j]=mesh_render_indices[i+j];}
    mesh_sources[cursor/3]=sources[i/3];mesh_caps[cursor/3]=cap_ids[i/3];
  }
  mesh_counts[0]=unique;mesh_counts[1]=rendered;mesh_counts[2]=size;mesh_counts[3]=bodies;
  return 0;
}

unsigned mesh_affected[max_vertices/3];
unsigned mesh_neighbors[max_vertices*2],mesh_queue[max_vertices],mesh_crease_ranges[max_vertices/3*2];
unsigned char mesh_flags[max_vertices],mesh_weights[max_vertices],mesh_backtrack[max_vertices];
double mesh_proposed[max_vertices*3],mesh_face_normals[max_vertices];
float mesh_creases[max_vertices*2];
void face_normal(const double* p,unsigned face,double* n){
  unsigned a=mesh_grouped_indices[face*3]*3,b=mesh_grouped_indices[face*3+1]*3,c=mesh_grouped_indices[face*3+2]*3;
  double ux=p[b]-p[a],uy=p[b+1]-p[a+1],uz=p[b+2]-p[a+2],vx=p[c]-p[a],vy=p[c+1]-p[a+1],vz=p[c+2]-p[a+2];
  n[0]=uy*vz-uz*vy;n[1]=uz*vx-ux*vz;n[2]=ux*vy-uy*vx;
}
double norm2(const double* p){return p[0]*p[0]+p[1]*p[1]+p[2]*p[2];}
int finish_mesh(){
  unsigned count=mesh_counts[0],size=mesh_counts[2],faces=size/3;
  for(unsigned v=0;v<count;v++){mesh_flags[v]=mesh_weights[v]=0;mesh_parents[v]=0;}
  for(unsigned f=0;f<faces;f++){
    face_normal(vertices,f,mesh_face_normals+f*3);
    for(int j=0;j<3;j++){
      unsigned v=mesh_grouped_indices[f*3+j];mesh_parents[v]++;
      if(mesh_sources[f]>=unsigned(base_groups))mesh_weights[v]=4;
      if(mesh_caps[f])mesh_flags[v]|=2;
      mesh_indices[f*3+j]=0xffffffffU;
    }
  }
  unsigned total=0;
  for(unsigned v=0;v<count;v++){unsigned degree=mesh_parents[v];mesh_parents[v]=total;mesh_cursors[v]=total;total+=degree;}mesh_parents[count]=total;
  for(unsigned f=0;f<faces;f++)for(int j=0;j<3;j++){
    unsigned v=mesh_grouped_indices[f*3+j],slot=mesh_cursors[v]++;
    mesh_sizes[slot]=f;mesh_neighbors[slot*2]=mesh_grouped_indices[f*3+(j+1)%3];mesh_neighbors[slot*2+1]=mesh_grouped_indices[f*3+(j+2)%3];
  }
  // A closed manifold has each neighbor twice in this face-based adjacency.
  // Keeping those paired entries avoids a large random-access edge hash table.
  for(unsigned f=0;f<faces;f++)for(int j=0;j<3;j++){
    if(mesh_indices[f*3+j]!=0xffffffffU)continue;
    unsigned a=mesh_grouped_indices[f*3+j],b=mesh_grouped_indices[f*3+(j+1)%3];
    for(unsigned at=mesh_parents[a];at<mesh_parents[a+1];at++){
      unsigned other=mesh_sizes[at];if(other==f)continue;bool found=false;
      for(int k=0;k<3;k++)if(mesh_grouped_indices[other*3+k]==b&&mesh_grouped_indices[other*3+(k+1)%3]==a){
        mesh_indices[f*3+j]=other;mesh_indices[other*3+k]=f;found=true;break;
      }
      if(!found)continue;
      if(mesh_sources[other]<unsigned(base_groups)&&mesh_sources[f]<unsigned(base_groups)){
        const double* u=mesh_face_normals+other*3;const double* v=mesh_face_normals+f*3;
        double dot=u[0]*v[0]+u[1]*v[1]+u[2]*v[2];
        if(mesh_sources[other]!=mesh_sources[f]||dot<__builtin_sqrt(norm2(u)*norm2(v))*.5){mesh_flags[a]|=1;mesh_flags[b]|=1;}
      }
      break;
    }
  }
  unsigned queued=0;
  for(unsigned v=0;v<count;v++)if(mesh_weights[v])mesh_queue[queued++]=v;
  unsigned begin=0,end=queued;
  for(int ring=1;ring<=3;ring++){
    for(unsigned i=begin;i<end;i++){unsigned v=mesh_queue[i];for(unsigned j=mesh_parents[v]*2;j<mesh_parents[v+1]*2;j++){unsigned n=mesh_neighbors[j];if(!mesh_weights[n]){mesh_weights[n]=4-ring;mesh_queue[queued++]=n;}}}
    begin=end;end=queued;
  }
  queued=0;for(unsigned v=0;v<count;v++)if(mesh_flags[v]&2)mesh_queue[queued++]=v;
  begin=0;end=queued;
  for(int ring=0;ring<=2;ring++){
    for(unsigned i=begin;i<end;i++){unsigned v=mesh_queue[i];mesh_flags[v]|=1;for(unsigned j=mesh_parents[v]*2;j<mesh_parents[v+1]*2;j++){unsigned n=mesh_neighbors[j];if(!(mesh_flags[n]&3)){mesh_flags[n]|=2;mesh_queue[queued++]=n;}}}
    begin=end;end=queued;
  }
  unsigned active=0;
  for(unsigned v=0;v<count;v++){if(mesh_flags[v]&1)mesh_weights[v]=0;if(mesh_weights[v])mesh_queue[active++]=v;for(int c=0;c<3;c++)mesh_original[v*3+c]=mesh_proposed[v*3+c]=vertices[v*3+c];}
  unsigned affected=0;
  for(unsigned f=0;f<faces;f++)if(mesh_weights[mesh_grouped_indices[f*3]]||mesh_weights[mesh_grouped_indices[f*3+1]]||mesh_weights[mesh_grouped_indices[f*3+2]])mesh_affected[affected++]=f;
  for(int pass=0;active&&pass<16;pass++){
    double factor=pass%2?-.53:.5;
    for(unsigned k=0;k<active;k++){
      unsigned v=mesh_queue[k],degree=(mesh_parents[v+1]-mesh_parents[v])*2;double average[3]={};
      for(unsigned j=mesh_parents[v]*2;j<mesh_parents[v+1]*2;j++)for(int c=0;c<3;c++)average[c]+=vertices[mesh_neighbors[j]*3+c]/degree;
      double distance2=0;
      for(int c=0;c<3;c++){mesh_proposed[v*3+c]=vertices[v*3+c]+factor*(mesh_weights[v]/4.0)*(average[c]-vertices[v*3+c]);double d=mesh_proposed[v*3+c]-mesh_original[v*3+c];distance2+=d*d;}
      double distance=__builtin_sqrt(distance2);
      if(distance>h*.75)for(int c=0;c<3;c++)mesh_proposed[v*3+c]=mesh_original[v*3+c]+(mesh_proposed[v*3+c]-mesh_original[v*3+c])*h*.75/distance;
    }
    for(unsigned j=0;j<affected;j++){unsigned f=mesh_affected[j];face_normal(vertices,f,mesh_face_normals+f*3);}
    bool accepted=false;
    for(int attempt=0;attempt<24;attempt++){
      for(unsigned k=0;k<active;k++)mesh_backtrack[mesh_queue[k]]=0;
      accepted=true;
      for(unsigned j=0;j<affected;j++){unsigned f=mesh_affected[j];
        double n[3];face_normal(mesh_proposed,f,n);const double* before=mesh_face_normals+f*3;
        if(!(n[0]*before[0]+n[1]*before[1]+n[2]*before[2]>=norm2(before)*.1)){
          accepted=false;for(int j=0;j<3;j++)mesh_backtrack[mesh_grouped_indices[f*3+j]]=1;
        }
      }
      if(accepted)break;
      for(unsigned k=0;k<active;k++){unsigned v=mesh_queue[k];if(mesh_backtrack[v])for(int c=0;c<3;c++)mesh_proposed[v*3+c]=(vertices[v*3+c]+mesh_proposed[v*3+c])*.5;}
    }
    if(accepted)for(unsigned k=0;k<active;k++){unsigned v=mesh_queue[k];for(int c=0;c<3;c++)vertices[v*3+c]=mesh_proposed[v*3+c];}
  }
  for(unsigned k=0;k<active;k++)for(int c=0;c<3;c++)mesh_proposed[mesh_queue[k]*3+c]=0;
  for(unsigned f=0;f<faces;f++){
    double n[3];face_normal(vertices,f,n);
    for(int j=0;j<3;j++){unsigned v=mesh_grouped_indices[f*3+j];if(mesh_weights[v])for(int c=0;c<3;c++)mesh_proposed[v*3+c]+=n[c];}
  }
  for(unsigned k=0;k<active;k++){unsigned v=mesh_queue[k];double length=max(__builtin_sqrt(norm2(mesh_proposed+v*3)),1e-30);for(int c=0;c<3;c++)mesh_normals[v*3+c]=float(mesh_proposed[v*3+c]/length);}
  for(int pass=0;pass<3;pass++){
    for(unsigned k=0;k<active;k++){
      unsigned v=mesh_queue[k];double n[3]={mesh_normals[v*3]*4.0,mesh_normals[v*3+1]*4.0,mesh_normals[v*3+2]*4.0};
      for(unsigned j=mesh_parents[v]*2;j<mesh_parents[v+1]*2;j++)for(int c=0;c<3;c++)n[c]+=mesh_normals[mesh_neighbors[j]*3+c];
      double length=max(__builtin_sqrt(norm2(n)),1e-30);for(int c=0;c<3;c++)mesh_proposed[v*3+c]=n[c]/length;
    }
    for(unsigned k=0;k<active;k++)for(int c=0;c<3;c++)mesh_normals[mesh_queue[k]*3+c]=float(mesh_proposed[mesh_queue[k]*3+c]);
  }
  for(unsigned r=0;r<mesh_counts[1];r++){unsigned v=render_vertex[r];if(mesh_weights[v])for(int c=0;c<3;c++){mesh_render_positions[r*3+c]=float(vertices[v*3+c]);normals[r*3+c]=mesh_normals[v*3+c];}}
  unsigned crease_count=0;
  for(unsigned body=0;body<mesh_counts[3];body++){
    mesh_crease_ranges[body*2]=crease_count/3;
    for(unsigned f=mesh_ranges[body*2]/3;f<(mesh_ranges[body*2]+mesh_ranges[body*2+1])/3;f++)for(int j=0;j<3;j++){
      unsigned other=mesh_indices[f*3+j];if(other==0xffffffffU||other>=f)continue;
      if(mesh_caps[other]!=mesh_caps[f]||(mesh_sources[other]!=mesh_sources[f]&&mesh_sources[other]<unsigned(base_groups)&&mesh_sources[f]<unsigned(base_groups))){
        if(crease_count+6>max_vertices*2)return -1;
        unsigned a=mesh_grouped_indices[f*3+j],b=mesh_grouped_indices[f*3+(j+1)%3];
        for(int c=0;c<3;c++)mesh_creases[crease_count++]=float(vertices[a*3+c]);
        for(int c=0;c<3;c++)mesh_creases[crease_count++]=float(vertices[b*3+c]);
      }
    }
    mesh_crease_ranges[body*2+1]=crease_count/3-mesh_crease_ranges[body*2];
  }
  mesh_counts[4]=crease_count;return 0;
}

unsigned merge_unique,merge_rendered,merge_capacity;
int begin_merge(int source_count,int estimated_vertices){
  if(source_count<1||source_count>max_segments||estimated_vertices<1||estimated_vertices>max_vertices)return -3;
  base_groups=source_count;h=settings[3];for(int c=0;c<3;c++)origin[c]=settings[c];
  output=0;merge_unique=merge_rendered=0;merge_capacity=1024;
  while(merge_capacity<unsigned(estimated_vertices)*2)merge_capacity*=2;
  if(merge_capacity>mesh_hash_capacity)return -3;
  for(unsigned i=0;i<merge_capacity;i++)weld_hash[i]=0;
  return 0;
}
int merge_chunk(int unique,int rendered,int size,double lower,double upper){
  if(unique<0||rendered<0||size<0||merge_unique+unique>max_vertices||merge_rendered+rendered>max_vertices||output+size>max_vertices||size%3)return -3;
  unsigned vstart=merge_unique,rstart=merge_rendered,mask=merge_capacity-1;
  long long* quantized=coordinate_scratch.quantized;
  for(int i=0;i<unique;i++){
    const double* p=vertices+(vstart+i)*3;unsigned v=merge_unique,slot=0;bool found=false;
    bool boundary=__builtin_fabs(p[2]-lower)<h*1e-6||__builtin_fabs(p[2]-upper)<h*1e-6;
    long long x=0,y=0,z=0;
    if(boundary){
      x=quantize(p[0]);y=quantize(p[1]);z=quantize(p[2]);slot=coordinate_hash(x,y,z)&mask;
      while(weld_hash[slot]){v=weld_hash[slot]-1;if(quantized[v*3]==x&&quantized[v*3+1]==y&&quantized[v*3+2]==z){found=true;break;}slot=(slot+1)&mask;}
    }
    if(!found){
      v=merge_unique++;mesh_parents[v]=v;mesh_sizes[v]=0;
      if(boundary){weld_hash[slot]=v+1;quantized[v*3]=x;quantized[v*3+1]=y;quantized[v*3+2]=z;}
      for(int c=0;c<3;c++){vertices[v*3+c]=p[c];mesh_normals[v*3+c]=mesh_normals[(vstart+i)*3+c];}
    }
    mesh_cursors[i]=v;
  }
  for(int r=0;r<rendered;r++){
    unsigned v=mesh_cursors[render_vertex[rstart+r]];render_vertex[rstart+r]=v;
    for(int c=0;c<3;c++)mesh_render_positions[(rstart+r)*3+c]=float(vertices[v*3+c]);
  }
  for(int i=0;i<size;i++){mesh_indices[output+i]=mesh_cursors[mesh_indices[output+i]];mesh_render_indices[output+i]+=rstart;}
  output+=size;merge_rendered+=rendered;
  mesh_counts[0]=merge_unique;mesh_counts[1]=merge_rendered;mesh_counts[2]=output;
  return 0;
}
