#pragma once
#include <QImage>
#include <QVector3D>
#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <vector>

// Orthographic depth rasterization keeps curved B-rep tessellations correctly
// occluded even when individual triangles span overlapping depth ranges.
class DepthRaster {
public:
    void clear(int width,int height) {
        image_=QImage(width,height,QImage::Format_ARGB32_Premultiplied);
        image_.fill(Qt::transparent);
        depth_.assign(size_t(width)*height,-std::numeric_limits<double>::infinity());
        owners_.assign(depth_.size(),-1);
    }
    const QImage& image()const{return image_;}
    double depthAt(int x,int y)const {
        if(x<0||y<0||x>=image_.width()||y>=image_.height())return -std::numeric_limits<double>::infinity();
        return depth_[size_t(y)*image_.width()+x];
    }
    // Compose the nearest surface of each transparent body, back to front at
    // each pixel. Opaque depth still occludes transparent bodies behind it.
    void composite(const std::vector<const DepthRaster*>& layers) {
        std::vector<const DepthRaster*> visible;
        for(int y=0;y<image_.height();++y)for(int x=0;x<image_.width();++x){
            const auto index=size_t(y)*image_.width()+x;visible.clear();
            for(auto* layer:layers)if(layer->image_.size()==image_.size()&&layer->depth_[index]>depth_[index])visible.push_back(layer);
            std::sort(visible.begin(),visible.end(),[index](auto* a,auto* b){return a->depth_[index]<b->depth_[index];});
            auto* pixel=reinterpret_cast<QRgb*>(image_.scanLine(y))+x;
            for(auto* layer:visible){const auto source=layer->image_.pixel(x,y);const int inverse=255-qAlpha(source);
                *pixel=qRgba(qRed(source)+(qRed(*pixel)*inverse+127)/255,qGreen(source)+(qGreen(*pixel)*inverse+127)/255,
                            qBlue(source)+(qBlue(*pixel)*inverse+127)/255,qAlpha(source)+(qAlpha(*pixel)*inverse+127)/255);
                owners_[index]=layer->owners_[index];
            }
            if(!visible.empty())depth_[index]=visible.back()->depth_[index];
        }
    }
    int ownerAt(int x,int y)const {
        if(x<0||y<0||x>=image_.width()||y>=image_.height())return -1;
        return owners_[size_t(y)*image_.width()+x];
    }
    void triangle(const std::array<QVector3D,3>& v,QRgb color,int owner) {
        if(image_.isNull())return;
        for(const auto& p:v)if(!std::isfinite(p.x())||!std::isfinite(p.y())||!std::isfinite(p.z()))return;
        const double ax=v[0].x(),ay=v[0].y(),bx=v[1].x(),by=v[1].y(),cx=v[2].x(),cy=v[2].y();
        const double area=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);
        if(std::abs(area)<1e-12)return;
        // Clamp before converting to int, including geometry far outside view.
        const int x0=int(std::floor(std::clamp(std::min({ax,bx,cx}),0.,double(image_.width()))));
        const int x1=int(std::ceil(std::clamp(std::max({ax,bx,cx}),0.,double(image_.width()))));
        const int y0=int(std::floor(std::clamp(std::min({ay,by,cy}),0.,double(image_.height()))));
        const int y1=int(std::ceil(std::clamp(std::max({ay,by,cy}),0.,double(image_.height()))));
        const double inverse=1/area;
        for(int y=y0;y<y1;++y) {
            auto* pixels=reinterpret_cast<QRgb*>(image_.scanLine(y));
            for(int x=x0;x<x1;++x) {
                const double u=((by-cy)*(x+.5-cx)+(cx-bx)*(y+.5-cy))*inverse;
                const double w=((cy-ay)*(x+.5-cx)+(ax-cx)*(y+.5-cy))*inverse;
                const double t=1-u-w;
                if(u< -1e-10||w< -1e-10||t< -1e-10)continue;
                const double z=u*v[0].z()+w*v[1].z()+t*v[2].z();
                const auto index=size_t(y)*image_.width()+x;
                if(z>depth_[index]){depth_[index]=z;owners_[index]=owner;pixels[x]=color;}
            }
        }
    }
private:
    QImage image_;
    std::vector<double> depth_;
    std::vector<int> owners_;
};
