#pragma once
#include <QIcon>
#include <QHash>
#include <QPainter>
#include <QPainterPath>
#include <QPixmap>

inline QIcon cadIcon(const QString& kind) {
    static QHash<QString,QIcon> icons;
    if(const auto found=icons.constFind(kind);found!=icons.cend())return *found;
    QPixmap bitmap(64,64);bitmap.fill(Qt::transparent);QPainter p(&bitmap);p.setRenderHint(QPainter::Antialiasing);p.scale(2,2);
    const QColor ink("#36556a"),blue("#6ca9c7"),pale("#d6e9f1"),gold("#e7b550");
    p.setPen(QPen(ink,1.2,Qt::SolidLine,Qt::RoundCap,Qt::RoundJoin));
    auto cube=[&]{p.setBrush(pale);p.drawPolygon(QPolygonF{{6,12},{16,7},{26,12},{16,18}});p.setBrush(blue);p.drawPolygon(QPolygonF{{6,12},{16,18},{16,28},{6,22}});p.setBrush(QColor("#8ebbd0"));p.drawPolygon(QPolygonF{{16,18},{26,12},{26,22},{16,28}});};
    if(kind.contains("plane")){p.setBrush(QColor(112,167,213,65));p.drawPolygon(QPolygonF{{6,7},{25,3},{25,24},{6,29}});p.setPen(QPen(blue,1,Qt::DashLine));p.drawLine(3,17,29,11);}
    else if(kind.contains("point")){p.setPen(QPen(ink,1));p.drawLine(4,24,27,24);p.drawLine(9,29,9,4);p.setBrush(gold);p.drawEllipse(QPointF(19,12),4,4);p.drawLine(19,5,19,19);p.drawLine(12,12,26,12);}
    else if(kind.contains("curve")||kind.contains("sweep")||kind.contains("blend")){QPainterPath path;path.moveTo(4,26);path.cubicTo(6,2,22,31,28,5);p.setPen(QPen(kind.contains("cut")?QColor("#c77949"):blue,kind.contains("curve")?2:6));p.drawPath(path);p.setPen(QPen(ink,1));p.setBrush(gold);for(auto point:{QPointF(4,26),QPointF(16,16),QPointF(28,5)})p.drawEllipse(point,2,2);}
    else if(kind.contains("circle")){p.setBrush(Qt::NoBrush);p.setPen(QPen(blue,1.8));p.drawEllipse(QRectF(5,5,22,22));p.setPen(ink);p.drawLine(13,16,19,16);p.drawLine(16,13,16,19);}
    else if(kind.contains("rectangle")){p.setBrush(pale);p.drawRect(QRectF(4,7,24,18));p.setBrush(blue);for(auto point:{QPointF(4,7),QPointF(28,7),QPointF(28,25),QPointF(4,25)})p.drawRect(QRectF(point-QPointF(1.5,1.5),QSizeF(3,3)));}
    else if(kind.contains("dimension")){p.setPen(QPen(blue,1));p.drawLine(6,4,6,28);p.drawLine(25,4,25,28);p.drawLine(6,9,25,9);p.setBrush(blue);p.drawPolygon(QPolygonF{{6,9},{11,6},{11,12}});p.drawPolygon(QPolygonF{{25,9},{20,6},{20,12}});p.setPen(ink);p.setFont(QFont("Segoe UI",9));p.drawText(QRectF(9,15,15,14),Qt::AlignCenter,"D");}
    else if(kind.contains("sketch")||kind.contains("polyline")){p.setBrush(pale);p.drawRect(5,5,21,22);p.setPen(QPen(blue,1.5));p.drawPolyline(QPolygonF{{7,23},{13,11},{20,21},{26,7}});p.setPen(QPen(gold,3));p.drawLine(12,24,25,11);}
    else if(kind.contains("fillet")){cube();p.setPen(QPen(gold,3));p.drawArc(QRectF(13,8,14,14),0,90*16);}
    else if(kind.contains("folder")){p.setBrush(gold);p.drawPolygon(QPolygonF{{3,8},{13,8},{16,12},{29,12},{27,26},{3,26}});p.setBrush(QColor("#f3d584"));p.drawPolygon(QPolygonF{{3,15},{29,15},{25,27},{3,27}});}
    else if(kind.contains("eye")||kind.contains("hide")){p.setBrush(pale);QPainterPath eye;eye.moveTo(3,16);eye.quadTo(16,2,29,16);eye.quadTo(16,30,3,16);p.drawPath(eye);p.setBrush(blue);p.drawEllipse(QPointF(16,16),4,4);if(kind.contains("hide")){p.setPen(QPen(QColor("#af5555"),2));p.drawLine(4,28,28,4);}}
    else {cube();if(kind.contains("cut")){p.setBrush(QColor("#f3c07b"));p.drawEllipse(QRectF(12,9,10,6));p.drawLine(12,12,12,21);p.drawLine(22,12,22,19);}else if(kind.contains("extrude")){p.setPen(QPen(gold,2));p.drawLine(16,17,16,2);p.drawLine(16,2,12,7);p.drawLine(16,2,20,7);}else if(kind.contains("delete")){p.setPen(QPen(QColor("#b44545"),2));p.drawLine(18,18,29,29);p.drawLine(29,18,18,29);}else if(kind.contains("transparent")){p.setBrush(QColor(255,255,255,150));p.drawRect(3,4,19,19);}}
    p.end();const QIcon icon(bitmap);icons.insert(kind,icon);return icon;
}
