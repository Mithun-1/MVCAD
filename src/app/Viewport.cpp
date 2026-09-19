#include "Viewport.h"
#include "ViewportMath.h"
#include "InteractionMesh.h"
#include "core/DocumentEditing.h"
#include <QElapsedTimer>
#include <QMouseEvent>
#include <QPainter>
#include <QPainterPath>
#include <QWheelEvent>
#include <QHash>
using namespace mvcad;
Viewport::Viewport(QWidget* p):QWidget(p){
    setMinimumSize(380,300);setFocusPolicy(Qt::StrongFocus);setObjectName("geometryViewport");isometricView();
    interactionEnd_.setSingleShot(true);connect(&interactionEnd_,&QTimer::timeout,this,[this]{interacting_=false;update();});
}
void Viewport::setDocument(const Document& document,std::shared_ptr<const VesselResult> geometry,double,bool fit){
    const bool changed=geometry!=vessels_;document_=document;vessels_=std::move(geometry);
    pendingGuides_.clear();if(!vessels_){pendingGuides_.reserve(document.network.branches.size());for(const auto& branch:document.network.branches)pendingGuides_.push_back(branch.points);}
    QHash<QString,bool> hiddenSets;for(const auto& set:document.pointSets)hiddenSets[set.id]=set.hidden;
    visiblePoints_.clear();for(const auto& point:document.points)visiblePoints_.push_back(!point.hidden&&!hiddenSets.value(point.setId,false));
    visibleCurves_=branchCurveVisibility(document);
    if(changed){
        normals_.clear();interactionNormals_.clear();interactionMesh_.clear();
        if(vessels_){normals_.reserve(vessels_->triangles.size());for(const auto& t:vessels_->triangles)normals_.push_back(unitTriangleNormal(t.a,t.b,t.c));
            interactionMesh_=interactionMesh(vessels_->triangles);interactionNormals_.reserve(interactionMesh_.size());for(const auto& t:interactionMesh_)interactionNormals_.push_back(unitTriangleNormal(t.a,t.b,t.c));}
    }
    ++meshRevision_;rasterKey_.clear();if(selected_>=int(document.network.branches.size()))selected_=-1;
    if(fit)fitAll();update();
}
void Viewport::setSelected(int i){selected_=i;update();}
void Viewport::setLabels(bool enabled){labels_=enabled;update();}
void Viewport::setCenterlines(bool enabled){if(centerlines_==enabled)return;centerlines_=enabled;emit centerlinesVisibilityChanged(enabled);update();}
void Viewport::setSelectedPoints(const std::vector<int>& points){selectedPoints_=QSet<int>(points.begin(),points.end());update();}
void Viewport::setBodyDisplay(const std::vector<mvcad::BodyDisplay>& states){document_.bodyDisplay=states;++meshRevision_;rasterKey_.clear();update();}
void Viewport::setBodySelection(const QString& id){bodySelection_=id;update();}
void Viewport::clearGeometrySelection(){bodySelection_.clear();update();}
void Viewport::frontView(){rotation_=QQuaternion();update();}
void Viewport::isometricView(){rotation_=QQuaternion::fromEulerAngles(25,-35,0);update();}
void Viewport::fitAll(){
    bool first=true;Vec3 lo,hi;auto include=[&](Vec3 p){if(first){lo=hi=p;first=false;}lo.x=std::min(lo.x,p.x);lo.y=std::min(lo.y,p.y);lo.z=std::min(lo.z,p.z);hi.x=std::max(hi.x,p.x);hi.y=std::max(hi.y,p.y);hi.z=std::max(hi.z,p.z);};
    for(size_t i=0;i<document_.points.size();++i)if(visiblePoints_[i])include(document_.points[i].position);
    for(size_t i=0;i<guides().size();++i)if(visibleCurves_[i]&&(!vessels_||centerlines_||document_.network.branches[i].diameter==0))for(auto p:guides()[i])include(p);
    if(vessels_&&!display().hidden&&display().opacity>0)for(const auto& t:vessels_->triangles){include(t.a);include(t.b);include(t.c);}
    if(first){lo={-25,-25,-25};hi={25,25,25};}center_=lo/2+hi/2;span_=std::max((hi-lo).length(),1e-3);zoom_=1;pan_={};update();
}
double Viewport::scale()const{return std::min(double(width()),height()*1.4)*.83*zoom_;}
QVector3D Viewport::rotate(Vec3 p)const{p=(p-center_)/span_;return rotation_.rotatedVector(QVector3D(float(p.x),float(p.y),float(p.z)));}
QPointF Viewport::project(Vec3 p)const{auto q=rotate(p);return QPointF(width()/2.+q.x()*scale(),height()/2.-q.y()*scale())+pan_;}
void Viewport::paintEvent(QPaintEvent*){
    QPainter p(this);p.fillRect(rect(),Qt::white);p.setRenderHint(QPainter::Antialiasing,true);drawSolidGeometry(p);
    for(int i=0;i<int(guides().size());++i){const auto& line=guides()[i];const auto& branch=document_.network.branches[i];if(!visibleCurves_[i]||line.empty())continue;
        if(!vessels_||branch.diameter==0||centerlines_){QPainterPath path;path.moveTo(project(line.front()));for(auto q:line)path.lineTo(project(q));p.setPen(QPen(i==selected_?QColor("#00a6ba"):QColor("#394e72"),i==selected_?2.5:1.3,branch.diameter>0?Qt::DashLine:Qt::SolidLine));p.drawPath(path);}
        if(labels_&&!interacting_){p.setPen(QColor("#334359"));p.drawText(project(line[line.size()/2])+QPointF(7,-7),branch.id+(branch.diameter>0?QString(" Ø%1").arg(branch.diameter):""));}
    }
    for(int i=0;i<int(document_.points.size());++i){if(!visiblePoints_[i])continue;const bool selected=selectedPoints_.contains(i);p.setPen(Qt::NoPen);p.setBrush(selected?QColor("#f49319"):QColor("#336fb3"));p.drawEllipse(project(document_.points[i].position),selected?4.:2.5,selected?4.:2.5);}
    if(document_.points.empty()&&document_.network.branches.empty()){p.setPen(QColor("#8190a0"));p.drawText(rect(),Qt::AlignCenter,"Import point sets or create points to begin");}
}
void Viewport::mousePressEvent(QMouseEvent* e){interactionEnd_.stop();if(interacting_){interacting_=false;repaint();}last_=e->position();dragged_=false;setFocus();}
void Viewport::mouseMoveEvent(QMouseEvent* e){auto delta=e->position()-last_;last_=e->position();if(!delta.isNull()&&e->buttons()!=Qt::NoButton){dragged_=true;interacting_=true;}
    if(e->buttons()&Qt::LeftButton)rotation_=QQuaternion::fromEulerAngles(float(delta.y()*.4),float(delta.x()*.4),0)*rotation_;
    if(e->buttons()&(Qt::RightButton|Qt::MiddleButton))pan_+=delta;if(e->buttons()!=Qt::NoButton)update();
}
void Viewport::mouseReleaseEvent(QMouseEvent* e){
    interacting_=false;if(dragged_){update();return;}if(e->button()!=Qt::LeftButton)return;
    int closest=-1;double pointDistance=9;for(int i=0;i<int(document_.points.size());++i){if(!visiblePoints_[i])continue;const double distance=QLineF(project(document_.points[i].position),e->position()).length();if(distance<pointDistance){pointDistance=distance;closest=i;}}
    if(closest>=0){emit pointSelected(closest,e->modifiers()&Qt::ControlModifier);return;}
    int selected=raster_.ownerAt(int(e->position().x()),int(e->position().y()));
    if(selected==-2){setBodySelection("vessels");emit bodySelected("vessels");return;}
    double best=64;if(selected<0)for(int i=0;i<int(guides().size());++i){if(!visibleCurves_[i]||(vessels_&&document_.network.branches[i].diameter>0&&!centerlines_))continue;const auto& line=guides()[i];
        for(size_t j=1;j<line.size();++j){auto a=project(line[j-1]),b=project(line[j]),v=b-a,w=e->position()-a;double length=QPointF::dotProduct(v,v);double t=length>0?std::clamp(QPointF::dotProduct(w,v)/length,0.,1.):0;auto delta=w-v*t;double distance=QPointF::dotProduct(delta,delta);if(distance<best){best=distance;selected=i;}}
    }
    bodySelection_.clear();setSelected(selected);emit branchSelected(selected);
}
void Viewport::wheelEvent(QWheelEvent* e){zoom_=std::clamp(zoom_*std::pow(1.0015,e->angleDelta().y()),.02,100.);interacting_=true;interactionEnd_.start(140);update();e->accept();}
QString Viewport::benchmarkRendering(){
    const auto saved=rotation_;QElapsedTimer clock;clock.start();for(int i=0;i<5;++i){rotation_=QQuaternion::fromEulerAngles(0,float(i),0)*saved;repaint();}const double full=clock.nsecsElapsed()/1e6/5;
    interacting_=true;clock.restart();for(int i=0;i<10;++i){rotation_=QQuaternion::fromEulerAngles(0,float(i),0)*saved;repaint();}const double orbit=clock.nsecsElapsed()/1e6/10;
    interacting_=false;repaint();clock.restart();for(int i=0;i<20;++i)repaint();const double cached=clock.nsecsElapsed()/1e6/20;rotation_=saved;update();
    return QString("Full detail: %1 ms/frame; orbit preview: %2 ms/frame (%3 triangles); unchanged redraw: %4 ms/frame; vessel fine triangles: %5").arg(full,0,'f',2).arg(orbit,0,'f',2).arg(interactionMesh_.size()).arg(cached,0,'f',2).arg(vessels_?vessels_->triangles.size():0);
}
