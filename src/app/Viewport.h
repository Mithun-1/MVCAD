#pragma once
#include "core/Preview.h"
#include <QWidget>
#include <QQuaternion>
#include <QPolygonF>

class Viewport : public QWidget {
    Q_OBJECT
public:
    explicit Viewport(QWidget* parent=nullptr);
    void setNetwork(const mvcad::Network& n,bool fit=false);
    void setSelected(int index);
    void setLabels(bool value);
    void setCenterlines(bool value);
    void fitAll();
    void frontView();
    void isometricView();
    int selected() const {return selected_;}
signals:
    void branchSelected(int index);
protected:
    void paintEvent(QPaintEvent*) override;
    void mousePressEvent(QMouseEvent*) override;
    void mouseMoveEvent(QMouseEvent*) override;
    void mouseReleaseEvent(QMouseEvent*) override;
    void wheelEvent(QWheelEvent*) override;
private:
    struct Face { QPolygonF polygon; double depth; QColor color; int branch; };
    mvcad::Network network_;
    mvcad::Preview preview_;
    mvcad::Vec3 center_;
    double span_=100,zoom_=1;
    QQuaternion rotation_;
    QPointF pan_,last_,pressed_;
    int selected_=-1;
    bool labels_=false,centerlines_=false,dragged_=false;
    std::vector<Face> faces_;
    QVector3D rotate(mvcad::Vec3 p) const;
    QPointF project(mvcad::Vec3 p) const;
    double scale() const;
};
