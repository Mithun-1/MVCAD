#include "Viewport.h"
#include "ViewportMath.h"
#include <QMouseEvent>
#include <QKeyEvent>
#include <QPainter>
#include <QPainterPath>
#include <QWheelEvent>
#include <algorithm>
#include <numbers>
using namespace mvcad;
Viewport::Viewport(QWidget* p):QWidget(p){setMinimumSize(380,300);setFocusPolicy(Qt::StrongFocus);setMouseTracking(true);setObjectName("geometryViewport");isometricView();}
void Viewport::setDocument(const Document& d,const CadResult& c,double precision,bool fit,const VesselResult* vessels){
    auto built=vessels?*vessels:buildVessels(d.network,precision,d.junctionRadius);
    document_=d;cad_=c;vessels_=std::move(built);preview_.centerlines=vessels_.centerlines;preview_.triangles=vessels_.triangles;precision_=precision;
    if(selected_>=int(d.network.branches.size()))selected_=-1;
    if(sketch_>=int(d.cad.sketches.size()))sketch_=-1;
    if(fit)fitAll();update();
}
void Viewport::setSelected(int i){selected_=i;update();}
void Viewport::setLabels(bool v){labels_=v;update();}
void Viewport::setCenterlines(bool v){if(centerlines_==v)return;centerlines_=v;emit centerlinesVisibilityChanged(v);update();}
void Viewport::setPlanesVisible(bool v){if(planes_==v)return;planes_=v;emit planesVisibilityChanged(v);update();}
void Viewport::selectPlane(int i){plane_=i;setPlanesVisible(true);update();}
void Viewport::setSelectedPoints(const std::vector<int>& points){selectedPoints_=points;update();}
void Viewport::frontView(){rotation_=QQuaternion();update();}
void Viewport::isometricView(){rotation_=QQuaternion::fromEulerAngles(25,-35,0);update();}
void Viewport::editSketch(int i){sketch_=i;drawing_.clear();setCursor(i>=0?Qt::CrossCursor:Qt::ArrowCursor);if(i>=0){const auto& s=document_.cad.sketches[i];plane_=int(s.plane);center_=planePoint(s.plane,{0,0},s.offset);span_=60;zoom_=1;pan_={};}else isometricView();setFocus();update();}
void Viewport::setSketchTool(ProfileType t){tool_=t;drawing_.clear();setFocus();update();}
void Viewport::fitAll(){
    if(sketch_>=0){const auto& s=document_.cad.sketches[sketch_];center_=planePoint(s.plane,{0,0},s.offset);span_=60;zoom_=1;pan_={};update();return;}
    bool first=true;Vec3 lo,hi;auto include=[&](Vec3 p){if(first){lo=hi=p;first=false;}lo.x=std::min(lo.x,p.x);lo.y=std::min(lo.y,p.y);lo.z=std::min(lo.z,p.z);hi.x=std::max(hi.x,p.x);hi.y=std::max(hi.y,p.y);hi.z=std::max(hi.z,p.z);};
    for(auto p:document_.points)include(p.position);
    for(const auto& line:preview_.centerlines)for(auto p:line)include(p);
    for(const auto& t:preview_.triangles){include(t.a);include(t.b);include(t.c);}
    for(const auto& t:cad_.triangles){include(t.a);include(t.b);include(t.c);}
    if(first){lo={-25,-25,-25};hi={25,25,25};}
    center_=lo/2+hi/2;span_=std::max((hi-lo).length(),1e-3);zoom_=1;pan_={};update();
}
double Viewport::scale()const{return std::min(double(width()),height()*1.4)*.83*zoom_;}
QVector3D Viewport::rotate(Vec3 p)const{p=(p-center_)/span_;if(sketch_>=0){auto plane=document_.cad.sketches[sketch_].plane;if(plane==Plane::Top)return {float(p.x),float(-p.z),float(p.y)};if(plane==Plane::Right)return {float(p.y),float(p.z),float(p.x)};return {float(p.x),float(p.y),float(p.z)};}return rotation_.rotatedVector(QVector3D(float(p.x),float(p.y),float(p.z)));}
QPointF Viewport::project(Vec3 p)const{auto q=rotate(p);return QPointF(width()/2.0+q.x()*scale(),height()/2.0-q.y()*scale())+pan_;}
QPointF Viewport::sketchPoint(QPointF p)const{return {(p.x()-width()/2.0-pan_.x())/scale()*span_,(height()/2.0+pan_.y()-p.y())/scale()*span_};}
QPolygonF Viewport::planePolygon(int i)const{QPolygonF polygon;for(auto p:{QPointF(-22,-22),QPointF(22,-22),QPointF(22,22),QPointF(-22,22)})polygon<<project(planePoint(static_cast<Plane>(i),p));return polygon;}
void Viewport::drawProfile(QPainter& p,const Sketch& s,const QColor& color){
    if(s.points.empty())return;QPainterPath path;auto project2=[&](QPointF q){return project(planePoint(s.plane,q,s.offset));};auto vertices=s.points;
    if(s.profile==ProfileType::Circle){if(s.radius<=0)return;vertices.clear();int sides=std::clamp(int(std::ceil(std::numbers::pi/std::acos(std::clamp(1-precision_/s.radius,-1.,1.)))),24,8192);for(int i=0;i<sides;++i){double a=2*std::numbers::pi*i/sides;vertices.push_back(s.points[0]+QPointF(std::cos(a)*s.radius,std::sin(a)*s.radius));}}
    else if(s.profile==ProfileType::Rectangle&&vertices.size()==2)vertices={vertices[0],{vertices[1].x(),vertices[0].y()},vertices[1],{vertices[0].x(),vertices[1].y()}};
    path.moveTo(project2(vertices.front()));for(auto q:vertices)path.lineTo(project2(q));if(vertices.size()>2)path.closeSubpath();p.setPen(QPen(color,1.7));p.setBrush(QColor(color.red(),color.green(),color.blue(),18));p.drawPath(path);
}
void Viewport::paintEvent(QPaintEvent*){
    QPainter p(this);p.fillRect(rect(),sketch_>=0?QColor("#fcfdff"):QColor("#fff"));p.setRenderHint(QPainter::Antialiasing,true);raster_.clear(width(),height());
    if(planes_&&sketch_<0)for(int i=0;i<3;++i){auto polygon=planePolygon(i);p.setPen(QPen(i==plane_?QColor("#226ed2"):QColor("#779dff"),i==plane_?1.5:1));p.setBrush(QColor(112,153,242,i==plane_?23:10));p.drawPolygon(polygon);p.drawText(polygon[3]+QPointF(5,-5),QStringList{"Front Plane","Top Plane","Right Plane"}[i]);}
    if(sketch_>=0){p.setPen(QPen(QColor("#e7edf5"),1));const auto& s=document_.cad.sketches[sketch_];double extent=span_/zoom_,step=std::pow(10.,std::floor(std::log10(extent/12)));for(int i=-100;i<=100;++i){double t=i*step;p.drawLine(project(planePoint(s.plane,{-extent,t},s.offset)),project(planePoint(s.plane,{extent,t},s.offset)));p.drawLine(project(planePoint(s.plane,{t,-extent},s.offset)),project(planePoint(s.plane,{t,extent},s.offset)));}p.setPen(QPen(QColor("#9bacbe"),1,Qt::DashLine));p.drawLine(project(planePoint(s.plane,{-extent,0},s.offset)),project(planePoint(s.plane,{extent,0},s.offset)));p.drawLine(project(planePoint(s.plane,{0,-extent},s.offset)),project(planePoint(s.plane,{0,extent},s.offset)));}
    const QVector3D light=QVector3D(-.3f,.4f,1).normalized();
    auto triangles=[&](const std::vector<Triangle>& mesh,bool cad){for(const auto& t:mesh){auto a=rotate(t.a),b=rotate(t.b),c=rotate(t.c);auto n=unitTriangleNormal(t.a,t.b,t.c);QVector3D normal;if(n.length()>0){normal=QVector3D(float(n.x),float(n.y),float(n.z));if(sketch_>=0){const auto plane=document_.cad.sketches[sketch_].plane;if(plane==Plane::Top)normal={float(n.x),float(-n.z),float(n.y)};else if(plane==Plane::Right)normal={float(n.y),float(n.z),float(n.x)};}else normal=rotation_.rotatedVector(normal);}float shade=.4f+.6f*std::abs(QVector3D::dotProduct(normal,light));QColor base=cad?QColor("#91a9c2"):((t.branch>=0&&t.branch==selected_)?QColor("#00b7cc"):(t.branch<0&&std::any_of(vessels_.junctions.begin(),vessels_.junctions.end(),[&](const auto& j){return j.index==-t.branch-1&&j.state==VesselBuildState::Provisional;})?QColor("#b781cc"):QColor("#c83f55")));QColor color;color.setRgbF(base.redF()*shade,base.greenF()*shade,base.blueF()*shade);if(sketch_>=0)color.setAlpha(60);auto screen=[&](QVector3D q){return QVector3D(float(width()/2.0+q.x()*scale()+pan_.x()),float(height()/2.0-q.y()*scale()+pan_.y()),q.z());};raster_.triangle({screen(a),screen(b),screen(c)},qPremultiply(color.rgba()),cad?-1000:t.branch);}};
    triangles(cad_.triangles,true);triangles(preview_.triangles,false);p.drawImage(0,0,raster_.image());p.setBrush(Qt::NoBrush);
    for(int i=0;i<int(preview_.centerlines.size());++i){const auto& line=preview_.centerlines[i];const auto& branch=document_.network.branches[i];if(branch.diameter==0||centerlines_){QPainterPath path;path.moveTo(project(line.front()));for(auto q:line)path.lineTo(project(q));p.setPen(QPen(i==selected_?QColor("#00a6ba"):QColor("#394e72"),i==selected_?2.5:1.3,branch.diameter>0?Qt::DashLine:Qt::SolidLine));p.drawPath(path);}if(labels_){p.setPen(QColor("#334359"));p.drawText(project(line[line.size()/2])+QPointF(7,-7),branch.id+(branch.diameter>0?QString("  Ø%1").arg(branch.diameter):""));}}
    if(document_.network.branches.empty()||centerlines_)for(int i=0;i<int(document_.points.size());++i){bool selected=std::find(selectedPoints_.begin(),selectedPoints_.end(),i)!=selectedPoints_.end();p.setPen(Qt::NoPen);p.setBrush(selected?QColor("#f49319"):QColor("#336fb3"));p.drawEllipse(project(document_.points[i].position),selected?4.:2.5,selected?4.:2.5);}
    for(int i=0;i<int(document_.cad.sketches.size());++i){bool consumed=std::any_of(document_.cad.features.begin(),document_.cad.features.end(),[i](auto f){return f.sketch==i;});if(!consumed||i==sketch_)drawProfile(p,document_.cad.sketches[i],i==sketch_?QColor("#1859bb"):QColor("#657b91"));}
    if(sketch_>=0){if(!drawing_.empty()){auto draft=document_.cad.sketches[sketch_];draft.profile=tool_;draft.points=drawing_;if(tool_==ProfileType::Circle)draft.radius=QLineF(drawing_[0],hover_).length();else draft.points.push_back(hover_);drawProfile(p,draft,QColor("#13a294"));}p.setPen(QColor("#405673"));p.drawText(QRect(15,12,width()-30,35),Qt::AlignLeft,QString("Editing %1 · %2 · Esc cancels drawing").arg(document_.cad.sketches[sketch_].id).arg(tool_==ProfileType::Circle?"Circle: center, then radius":tool_==ProfileType::Rectangle?"Rectangle: two opposite corners":"Polyline: click vertices, Enter closes"));}
    if(planes_||sketch_>=0){auto origin=project({});p.setPen(QPen(QColor("#303d4f"),1));p.drawLine(origin-QPointF(4,0),origin+QPointF(4,0));p.drawLine(origin-QPointF(0,4),origin+QPointF(0,4));}
}
void Viewport::mousePressEvent(QMouseEvent* e){last_=pressed_=e->position();dragged_=false;setFocus();}
void Viewport::mouseMoveEvent(QMouseEvent* e){auto delta=e->position()-last_;last_=e->position();hover_=sketchPoint(e->position());if((e->position()-pressed_).manhattanLength()>4)dragged_=true;if((e->buttons()&Qt::LeftButton)&&sketch_<0)rotation_=QQuaternion::fromEulerAngles(float(delta.y()*.4),float(delta.x()*.4),0)*rotation_;if(e->buttons()&(Qt::RightButton|Qt::MiddleButton))pan_+=delta;if(e->buttons()!=Qt::NoButton||(sketch_>=0&&!drawing_.empty()))update();}
void Viewport::mouseReleaseEvent(QMouseEvent* e){
    if(e->button()!=Qt::LeftButton||dragged_)return;
    if(sketch_>=0){auto q=sketchPoint(e->position());if(QLineF(q,{0,0}).length()<span_/scale()*7)q={0,0};drawing_.push_back(q);if(tool_!=ProfileType::Polyline&&drawing_.size()==2){auto s=document_.cad.sketches[sketch_];s.profile=tool_;s.points=drawing_;if(tool_==ProfileType::Circle){s.radius=QLineF(s.points[0],s.points[1]).length();s.points.resize(1);}drawing_.clear();emit sketchDrawn(s);}update();return;}
    if(document_.network.branches.empty()||centerlines_){int closest=-1;double best=9;for(int i=0;i<int(document_.points.size());++i){double dist=QLineF(project(document_.points[i].position),e->position()).length();if(dist<best){best=dist;closest=i;}}if(closest>=0){emit pointSelected(closest,e->modifiers()&Qt::ControlModifier);return;}}
    int selected=raster_.ownerAt(int(e->position().x()),int(e->position().y()));if(selected<0)selected=-1;
    double best=64;if(selected<0)for(int i=0;i<int(preview_.centerlines.size());++i){const auto& line=preview_.centerlines[i];for(size_t j=1;j<line.size();++j){auto a=project(line[j-1]),b=project(line[j]),v=b-a,w=e->position()-a;double length=QPointF::dotProduct(v,v);double t=length>0?std::clamp(QPointF::dotProduct(w,v)/length,0.,1.):0;auto delta=w-v*t;double distance=QPointF::dotProduct(delta,delta);if(distance<best){best=distance;selected=i;}}}
    if(selected<0&&planes_)for(int i=0;i<3;++i)if(planePolygon(i).containsPoint(e->position(),Qt::OddEvenFill)){emit planeSelected(i);return;}
    setSelected(selected);emit branchSelected(selected);
}
void Viewport::finishPolyline(){if(sketch_>=0&&drawing_.size()>=3){auto s=document_.cad.sketches[sketch_];s.profile=ProfileType::Polyline;s.points=drawing_;s.radius=0;drawing_.clear();emit sketchDrawn(s);update();}}
void Viewport::keyPressEvent(QKeyEvent* e){if(sketch_>=0){if(e->key()==Qt::Key_Return||e->key()==Qt::Key_Enter){finishPolyline();return;}if(e->key()==Qt::Key_Escape){drawing_.clear();update();return;}}QWidget::keyPressEvent(e);}
void Viewport::wheelEvent(QWheelEvent* e){zoom_=std::clamp(zoom_*std::pow(1.0015,e->angleDelta().y()),.02,100.);update();e->accept();}
