#include "Viewport.h"
#include <QPainter>
using namespace mvcad;
BodyDisplay Viewport::display()const{for(const auto& state:document_.bodyDisplay)if(state.bodyId=="vessels")return state;return {"vessels",false,1};}
void Viewport::drawSolidGeometry(QPainter& painter){
    const QString key=QString("%1/%2/%3/%4/%5/%6/%7/%8/%9/%10/%11/%12/%13/%14/%15/%16").arg(meshRevision_).arg(interacting_).arg(width()).arg(height()).arg(rotation_.scalar(),0,'g',9).arg(rotation_.x(),0,'g',9).arg(rotation_.y(),0,'g',9).arg(rotation_.z(),0,'g',9).arg(pan_.x()).arg(pan_.y()).arg(zoom_,0,'g',17).arg(selected_).arg(bodySelection_).arg(center_.x,0,'g',17).arg(center_.y,0,'g',17).arg(center_.z,0,'g',17)+"/"+QString::number(span_,'g',17);
    if(key!=rasterKey_){
        raster_.clear(width(),height());const auto state=display();
        if(vessels_&&!state.hidden&&state.opacity>0){
            const auto ex=rotation_.rotatedVector(QVector3D(1,0,0)),ey=rotation_.rotatedVector(QVector3D(0,1,0)),ez=rotation_.rotatedVector(QVector3D(0,0,1));const auto factor=scale();
            auto screen=[&](Vec3 p){p=(p-center_)/span_;const auto q=ex*float(p.x)+ey*float(p.y)+ez*float(p.z);return QVector3D(float(width()/2.+q.x()*factor+pan_.x()),float(height()/2.-q.y()*factor+pan_.y()),q.z());};
            const auto& triangles=interacting_?interactionMesh_:vessels_->triangles;const auto& normals=interacting_?interactionNormals_:normals_;
            const auto light=QVector3D(-.3f,.4f,1).normalized();QSet<int> provisional;for(const auto& j:vessels_->junctions)if(j.state==VesselBuildState::Provisional)provisional.insert(-j.index-1);
            for(size_t i=0;i<triangles.size();++i){const auto& triangle=triangles[i];const auto n=normals[i];const auto normal=ex*float(n.x)+ey*float(n.y)+ez*float(n.z);if(state.opacity>=1&&normal.z()<=0)continue;
                const double shade=.4+.6*std::abs(QVector3D::dotProduct(normal,light));QColor base=bodySelection_=="vessels"?QColor(119,181,208):QColor(200,63,85);
                if(triangle.branch>=0&&triangle.branch==selected_)base=QColor(0,183,204);else if(provisional.contains(triangle.branch))base=QColor(183,129,204);
                QColor color;color.setRgbF(base.redF()*shade,base.greenF()*shade,base.blueF()*shade,state.opacity);
                raster_.triangle({screen(triangle.a),screen(triangle.b),screen(triangle.c)},qPremultiply(color.rgba()),triangle.branch>=0?triangle.branch:-2);
            }
        }
        rasterKey_=key;
    }
    painter.drawImage(0,0,raster_.image());
}
