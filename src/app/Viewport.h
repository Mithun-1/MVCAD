#pragma once
#include "core/Document.h"
#include "DepthRaster.h"
#include <QWidget>
#include <QQuaternion>
#include <QTimer>
#include <QSet>
#include <memory>
class QPainter;
class Viewport:public QWidget {
    Q_OBJECT
public:
    explicit Viewport(QWidget* parent=nullptr);
    void setDocument(const mvcad::Document&,std::shared_ptr<const mvcad::VesselResult>,double precision,bool fit=false);
    void setSelected(int);int selected()const{return selected_;}
    void setLabels(bool);void setCenterlines(bool);void setSelectedPoints(const std::vector<int>&);
    void fitAll();void frontView();void isometricView();
    void setBodyDisplay(const std::vector<mvcad::BodyDisplay>&);
    void setBodySelection(const QString&);void clearGeometrySelection();QString selectedBody()const{return bodySelection_;}
    QString benchmarkRendering();
signals:
    void branchSelected(int);void pointSelected(int,bool toggle);void bodySelected(const QString&);void centerlinesVisibilityChanged(bool);
protected:
    void paintEvent(QPaintEvent*)override;void mousePressEvent(QMouseEvent*)override;
    void mouseMoveEvent(QMouseEvent*)override;void mouseReleaseEvent(QMouseEvent*)override;void wheelEvent(QWheelEvent*)override;
private:
    mvcad::Document document_;
    std::shared_ptr<const mvcad::VesselResult> vessels_;
    std::vector<std::vector<mvcad::Vec3>> pendingGuides_;
    const std::vector<std::vector<mvcad::Vec3>>& guides()const{return vessels_?vessels_->centerlines:pendingGuides_;}
    std::vector<bool> visiblePoints_,visibleCurves_;
    QSet<int> selectedPoints_;
    std::vector<mvcad::Vec3> normals_,interactionNormals_;
    std::vector<mvcad::Triangle> interactionMesh_;
    DepthRaster raster_;QString rasterKey_,bodySelection_;size_t meshRevision_=0;
    bool interacting_=false,dragged_=false,labels_=false,centerlines_=false;
    QTimer interactionEnd_;
    mvcad::Vec3 center_;double span_=80,zoom_=1;
    QQuaternion rotation_;QPointF pan_,last_;
    int selected_=-1;
    mvcad::BodyDisplay display()const;
    void drawSolidGeometry(QPainter&);
    QVector3D rotate(mvcad::Vec3)const;QPointF project(mvcad::Vec3)const;double scale()const;
};
