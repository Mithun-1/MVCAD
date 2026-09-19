#include "app/DepthRaster.h"
#include "app/ViewportMath.h"
#include "app/InteractionMesh.h"

#include <QTest>
#include <array>

namespace {

using ScreenTriangle=std::array<QVector3D,3>;

constexpr QRgb red=qRgba(220,40,30,255);
constexpr QRgb blue=qRgba(30,80,220,255);

ScreenTriangle triangleAt(float z) {
    return {{{1,1,z},{13,1,z},{1,13,z}}};
}

} // namespace

class ViewportTests:public QObject {
    Q_OBJECT
private slots:
    void interactionPreviewPreservesFineMeshAndOwnership(){
        using mvcad::Triangle;using mvcad::Vec3;
        const Triangle face{{0,0,0},{1,0,0},{0,1,0},7};
        std::vector<Triangle> fine(30000,face);
        fine.push_back({face.a,face.b,face.c,8});
        fine.push_back({face.a,face.c,face.b,7});
        const auto coarse=interactionMesh(fine);
        QCOMPARE(coarse.size(),size_t(3));
        QCOMPARE(fine.size(),size_t(30002));
        QCOMPARE(fine.front().b.x,1.);QCOMPARE(fine.front().c.y,1.);
        QCOMPARE(coarse[0].branch,7);QCOMPARE(coarse[1].branch,8);
        QVERIFY((coarse[2].b-coarse[2].a).cross(coarse[2].c-coarse[2].a).z<0);
        for(size_t i=0;i<2;++i){const auto& triangle=coarse[i];
            QVERIFY((triangle.b-triangle.a).cross(triangle.c-triangle.a).z>0);
            QVERIFY((triangle.a-face.a).length()<.004);
            QVERIFY((triangle.b-face.b).length()<.004);
            QVERIFY((triangle.c-face.c).length()<.004);
        }
    }
    void transparentBodiesCompositeOverOpaqueGeometry(){
        DepthRaster opaque,near,far;opaque.clear(16,16);near.clear(16,16);far.clear(16,16);
        opaque.triangle(triangleAt(.2f),blue,1);
        far.triangle(triangleAt(.1f),red,2); // Occluded by opaque geometry.
        near.triangle(triangleAt(.8f),qPremultiply(qRgba(220,40,30,128)),3);
        opaque.composite({&near,&far});
        QCOMPARE(opaque.ownerAt(4,4),3);QCOMPARE(qAlpha(opaque.image().pixel(4,4)),255);
        QVERIFY(qRed(opaque.image().pixel(4,4))>100);QVERIFY(qBlue(opaque.image().pixel(4,4))>100);
        QVERIFY(opaque.depthAt(4,4)>.79);
    }
    void smallMeshFacesKeepTheirLightingNormal(){
        for(double scale:{1e-9,1e-5,1.,1e5}){
            const auto normal=unitTriangleNormal({0,0,0},{scale,0,0},{0,scale,0});
            QCOMPARE(normal.x,0.);QCOMPARE(normal.y,0.);QVERIFY(std::abs(normal.z-1)<1e-12);
        }
        QCOMPARE(unitTriangleNormal({0,0,0},{0,0,0},{1,0,0}).length(),0.);
    }
    void nearerTriangleWinsRegardlessOfSubmissionOrder(){
        DepthRaster first,second;
        first.clear(16,16);second.clear(16,16);
        first.triangle(triangleAt(.2f),red,1);
        first.triangle(triangleAt(.8f),blue,2);
        second.triangle(triangleAt(.8f),blue,2);
        second.triangle(triangleAt(.2f),red,1);

        QVERIFY(first.image()==second.image());
        QCOMPARE(first.image().pixel(4,4),blue);
        QCOMPARE(first.ownerAt(4,4),2);
        QCOMPARE(second.ownerAt(4,4),2);
    }

    void interpolatedDepthSelectsDifferentOwnersAcrossIntersection(){
        DepthRaster raster;
        raster.clear(16,16);
        const ScreenTriangle sloped{{{1,1,0},{13,1,1},{1,13,0}}};
        raster.triangle(sloped,red,7);
        raster.triangle(triangleAt(.5f),blue,9);

        QCOMPARE(raster.ownerAt(3,3),9);
        QCOMPARE(raster.image().pixel(3,3),blue);
        QCOMPARE(raster.ownerAt(9,2),7);
        QCOMPARE(raster.image().pixel(9,2),red);

        DepthRaster reversed;
        reversed.clear(16,16);
        reversed.triangle(triangleAt(.5f),blue,9);
        reversed.triangle(sloped,red,7);
        QVERIFY(raster.image()==reversed.image());
        QCOMPARE(reversed.ownerAt(3,3),9);
        QCOMPARE(reversed.ownerAt(9,2),7);
    }

    void clipsTrianglesAndBoundsOwnershipQueries(){
        DepthRaster raster;
        raster.clear(5,5);
        const ScreenTriangle clipped{{{-5,-5,.5f},{8,-5,.5f},{-5,8,.5f}}};
        raster.triangle(clipped,red,12);
        QCOMPARE(raster.ownerAt(1,1),12);
        QCOMPARE(raster.image().pixel(1,1),red);
        QCOMPARE(raster.ownerAt(4,4),-1);
        QCOMPARE(raster.ownerAt(-1,1),-1);
        QCOMPARE(raster.ownerAt(1,-1),-1);
        QCOMPARE(raster.ownerAt(5,1),-1);
        QCOMPARE(raster.ownerAt(1,5),-1);

        const auto before=raster.image();
        const ScreenTriangle outside{{{-9,-9,1},{-7,-9,1},{-9,-7,1}}};
        raster.triangle(outside,blue,99);
        QVERIFY(raster.image()==before);
    }

    void degenerateTriangleWritesNothing(){
        DepthRaster raster;
        raster.clear(8,8);
        const ScreenTriangle line{{{1,1,.2f},{3,3,.5f},{6,6,.9f}}};
        raster.triangle(line,red,4);
        for(int y=0;y<8;++y) for(int x=0;x<8;++x) {
            QCOMPARE(qAlpha(raster.image().pixel(x,y)),0);
            QCOMPARE(raster.ownerAt(x,y),-1);
        }
    }

    void clearResetsImageAndOwnerSelection(){
        DepthRaster raster;
        raster.clear(10,9);
        raster.triangle(triangleAt(.5f),blue,42);
        QCOMPARE(raster.ownerAt(3,3),42);
        raster.clear(4,3);
        QCOMPARE(raster.image().size(),QSize(4,3));
        for(int y=0;y<3;++y) for(int x=0;x<4;++x) {
            QCOMPARE(qAlpha(raster.image().pixel(x,y)),0);
            QCOMPARE(raster.ownerAt(x,y),-1);
        }
    }
};

QTEST_GUILESS_MAIN(ViewportTests)
#include "ViewportTests.moc"
