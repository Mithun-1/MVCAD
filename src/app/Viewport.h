#pragma once
#include "core/Document.h"
#include "DepthRaster.h"
#include <QWidget>
#include <QQuaternion>
#include <QPolygonF>
class QPainter;
class Viewport:public QWidget {
    Q_OBJECT
public:
    explicit Viewport(QWidget* parent=nullptr);
    void setDocument(const mvcad::Document&,const mvcad::CadResult&,double precision,bool fit=false,const mvcad::VesselResult* vessels=nullptr);
    void setSelected(int);void setLabels(bool);void setCenterlines(bool);
    void setPlanesVisible(bool);void selectPlane(int);
    void setSelectedPoints(const std::vector<int>&);
    void editSketch(int);void setSketchTool(mvcad::ProfileType);
    void cancelDrawing(){drawing_.clear();update();}
    void fitAll();void frontView();void isometricView();
    int selected()const{return selected_;}
signals:
    void branchSelected(int);void planeSelected(int);void pointSelected(int,bool toggle);
    void planesVisibilityChanged(bool);
    void centerlinesVisibilityChanged(bool);
    void sketchDrawn(const mvcad::Sketch&);
protected:
    void paintEvent(QPaintEvent*)override;void mousePressEvent(QMouseEvent*)override;
    void mouseMoveEvent(QMouseEvent*)override;void mouseReleaseEvent(QMouseEvent*)override;
    void wheelEvent(QWheelEvent*)override;void keyPressEvent(QKeyEvent*)override;
private:
    DepthRaster raster_;
    mvcad::Document document_;mvcad::Preview preview_;mvcad::CadResult cad_;
    mvcad::VesselResult vessels_;
    mvcad::Vec3 center_;double span_=80,zoom_=1,precision_=1e-3;
    QQuaternion rotation_;QPointF pan_,last_,pressed_,hover_;
    int selected_=-1,plane_=0,sketch_=-1;
    bool labels_=false,centerlines_=false,planes_=true,dragged_=false;
    mvcad::ProfileType tool_=mvcad::ProfileType::Rectangle;
    std::vector<QPointF> drawing_;std::vector<int> selectedPoints_;
    QVector3D rotate(mvcad::Vec3)const;QPointF project(mvcad::Vec3)const;double scale()const;
    QPointF sketchPoint(QPointF)const;QPolygonF planePolygon(int)const;
    void finishPolyline();void drawProfile(QPainter&,const mvcad::Sketch&,const QColor&);
};
