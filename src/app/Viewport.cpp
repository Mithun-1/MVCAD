#include "Viewport.h"
#include <QMouseEvent>
#include <QPainter>
#include <QPainterPath>
#include <QWheelEvent>
#include <algorithm>
#include <limits>

Viewport::Viewport(QWidget* parent):QWidget(parent) {
    setMinimumSize(380,300);setFocusPolicy(Qt::StrongFocus);setMouseTracking(true);
    setObjectName("geometryViewport");isometricView();
    setToolTip("Left drag: orbit · Right/middle drag: pan · Wheel: zoom · Click: select branch");
}
void Viewport::setNetwork(const mvcad::Network& n,bool fit) {
    auto preview=mvcad::makePreview(n);
    network_=n;preview_=std::move(preview);
    if(selected_>=static_cast<int>(n.branches.size())) selected_=-1;
    if(fit) fitAll();update();
}
void Viewport::setSelected(int i){selected_=i;update();}
void Viewport::setLabels(bool v){labels_=v;update();}
void Viewport::setCenterlines(bool v){centerlines_=v;update();}
void Viewport::frontView(){rotation_=QQuaternion();update();}
void Viewport::isometricView(){rotation_=QQuaternion::fromEulerAngles(18,-12,0);update();}
void Viewport::fitAll() {
    bool first=true; mvcad::Vec3 lo,hi;
    for(const auto& b:network_.branches) for(auto p:b.points) {
        const double r=b.diameter/2;
        if(first) {lo=p-mvcad::Vec3{r,r,r};hi=p+mvcad::Vec3{r,r,r};first=false;}
        lo.x=std::min(lo.x,p.x-r);lo.y=std::min(lo.y,p.y-r);lo.z=std::min(lo.z,p.z-r);
        hi.x=std::max(hi.x,p.x+r);hi.y=std::max(hi.y,p.y+r);hi.z=std::max(hi.z,p.z+r);
    }
    center_=(lo+hi)/2;span_=std::max((hi-lo).length(),1e-9);zoom_=1;pan_={};update();
}
double Viewport::scale() const {return std::min(static_cast<double>(width()),height()*1.55)*.85/span_*zoom_;}
QVector3D Viewport::rotate(mvcad::Vec3 p) const {
    p=p-center_;return rotation_.rotatedVector(QVector3D(static_cast<float>(p.x),static_cast<float>(p.y),static_cast<float>(p.z)));
}
QPointF Viewport::project(mvcad::Vec3 p) const {
    auto q=rotate(p);return QPointF(width()/2.0+q.x()*scale(),height()/2.0-q.y()*scale())+pan_;
}
void Viewport::paintEvent(QPaintEvent*) {
    QPainter painter(this);painter.fillRect(rect(),QColor("#171d25"));
    faces_.clear();
    if(network_.branches.empty()) {
        painter.setPen(QColor("#f0f3f7"));QFont f=font();f.setPointSize(23);f.setWeight(QFont::Medium);painter.setFont(f);
        painter.drawText(rect().adjusted(30,-55,-30,0),Qt::AlignCenter,"Build from your centerlines");
        f.setPointSize(11);f.setWeight(QFont::Normal);painter.setFont(f);painter.setPen(QColor("#a7b3c3"));
        painter.drawText(rect().adjusted(30,25,-30,0),Qt::AlignCenter,"Import points to start a network, or open the included example.\nFile → Import Centerlines   ·   File → Open Example");
        return;
    }
    faces_.reserve(preview_.triangles.size());
    const QVector3D light=QVector3D(-.35f,.4f,1).normalized();
    for(const auto& t:preview_.triangles) {
        auto a=rotate(t.a),b=rotate(t.b),c=rotate(t.c);
        auto normal=QVector3D::crossProduct(b-a,c-a).normalized();
        const float shade=.3f+.7f*std::max(0.f,QVector3D::dotProduct(normal,light));
        const QColor base=t.branch==selected_?QColor("#14cbe0"):QColor("#d5334b");
        QColor color; color.setRgbF(base.redF()*shade,base.greenF()*shade,base.blueF()*shade);
        faces_.push_back({QPolygonF{project(t.a),project(t.b),project(t.c)},(a.z()+b.z()+c.z())/3.0,color,t.branch});
    }
    std::sort(faces_.begin(),faces_.end(),[](const Face& a,const Face& b){return a.depth<b.depth;});
    painter.setRenderHint(QPainter::Antialiasing,false);
    for(const auto& f:faces_) {painter.setPen(QPen(f.color,.6));painter.setBrush(f.color);painter.drawPolygon(f.polygon);}
    painter.setRenderHint(QPainter::Antialiasing,true);painter.setBrush(Qt::NoBrush);
    for(int i=0;i<static_cast<int>(preview_.centerlines.size());++i) {
        const auto& line=preview_.centerlines[i]; const auto& b=network_.branches[i];
        if(b.diameter==0||centerlines_) {
            QPainterPath path;path.moveTo(project(line.front()));for(auto p:line)path.lineTo(project(p));
            QPen pen(i==selected_?QColor("#23d8ee"):QColor("#9ca9ba"),i==selected_?2.3:1.4);
            if(b.diameter>0)pen.setStyle(Qt::DashLine);painter.setPen(pen);painter.drawPath(path);
        }
        if(labels_) {
            painter.setPen(QColor("#e6ebf0"));
            const auto label=b.diameter>0?QString("%1  Ø%2").arg(b.id).arg(b.diameter):b.id+"  Unassigned";
            painter.drawText(project(line[line.size()/2])+QPointF(9,-8),label);
        }
    }
}
void Viewport::mousePressEvent(QMouseEvent* e){last_=pressed_=e->position();dragged_=false;setFocus();}
void Viewport::mouseMoveEvent(QMouseEvent* e) {
    const auto delta=e->position()-last_;last_=e->position();
    if((e->position()-pressed_).manhattanLength()>4)dragged_=true;
    if(e->buttons()&Qt::LeftButton) rotation_=QQuaternion::fromEulerAngles(static_cast<float>(delta.y()*.4),static_cast<float>(delta.x()*.4),0)*rotation_;
    if(e->buttons()&(Qt::RightButton|Qt::MiddleButton))pan_+=delta;
    if(e->buttons())update();
}
void Viewport::mouseReleaseEvent(QMouseEvent* e) {
    if(e->button()!=Qt::LeftButton||dragged_)return;
    int selected=-1;
    for(auto it=faces_.rbegin();it!=faces_.rend();++it) if(it->polygon.containsPoint(e->position(),Qt::OddEvenFill)){selected=it->branch;break;}
    double best=64;
    if(selected<0)for(int i=0;i<static_cast<int>(preview_.centerlines.size());++i) {
        const auto& line=preview_.centerlines[i];
        for(size_t j=1;j<line.size();++j) {
            auto a=project(line[j-1]),b=project(line[j]),v=b-a,w=e->position()-a;
            const double length=QPointF::dotProduct(v,v);
            const double t=length>0?std::clamp(QPointF::dotProduct(w,v)/length,0.0,1.0):0;
            auto d=w-v*t;const double distance=QPointF::dotProduct(d,d);
            if(distance<best){best=distance;selected=i;}
        }
    }
    setSelected(selected);emit branchSelected(selected);
}
void Viewport::wheelEvent(QWheelEvent* e){zoom_=std::clamp(zoom_*std::pow(1.0015,e->angleDelta().y()),.02,100.0);update();e->accept();}
