#include "MainWindow.h"
#include "Viewport.h"
#include "core/DocumentEditing.h"
#include <QApplication>
#include <QDir>
#include <QElapsedTimer>
#include <QFile>
#include <QJsonDocument>
#include <QJsonArray>
#include <QStatusBar>
#include <QTimer>
#include <QTreeWidgetItemIterator>
#include <QTreeWidget>
#include <QUndoStack>
#include <cmath>
#include <stdexcept>
using namespace mvcad;

bool MainWindow::verificationGeometry(const QString& directory){
    QDir().mkpath(directory);if(!waitForBuild())throw std::runtime_error("Pending geometry build did not finish.");Document model;
    appendPointSet(model,"Mother axis",{{"Inlet",{-32.5,0,0}},{"Junction",{0,0,0}}});
    appendPointSet(model,"Upper daughter",{{"D1",{8,4,0}},{"D2",{20,10,0}},{"D3",{35,22,0}},{"D4",{50,30,0}},{"Outlet",{67.5,30,0}}});
    model.curveDefinitions={{"Mother axis",{"Inlet","Junction"},false},{"Upper daughter",{"Junction","D1","D2","D3","D4","Outlet"},false}};
    regenerateCenterlines(model);mirrorCenterline(model,"Upper daughter","Mother axis","Mirrored daughter");
    if(model.network.branches.size()!=3)throw std::runtime_error("Verification mirror did not produce exactly three vessel branches.");
    for(auto& branch:model.network.branches){bool mother=true;for(auto p:branch.points)mother=mother&&std::abs(p.y)<1e-10;branch.diameter=mother?9:7.5;branch.startSetback=branch.endSetback=.35;}
    const auto& source=model.network.curves[1];const auto& mirrored=model.network.curves[2];
    if(source.points.size()!=mirrored.points.size())throw std::runtime_error("Mirrored curve point count differs.");
    double symmetryError=0;for(size_t i=0;i<source.points.size();++i)symmetryError=std::max(symmetryError,(Vec3{source.points[i].x,-source.points[i].y,source.points[i].z}-mirrored.points[i]).length());
    if(symmetryError>1e-12)throw std::runtime_error("Mirror lost exact coordinate symmetry.");
    QElapsedTimer clock;clock.start();auto geometry=buildVessels(model.network,precision_,model.junctionRadius);const double cold=clock.nsecsElapsed()/1e6;
    clock.restart();auto cached=buildVessels(model.network,precision_,model.junctionRadius);const double warm=clock.nsecsElapsed()/1e6;
    QJsonArray junctions;bool valid=true;
    for(const auto& result:geometry.junctions){valid=valid&&result.state==VesselBuildState::Built;junctions.append(QJsonObject{{"message",result.message},{"state",int(result.state)},{"maximumSeamAngle",result.maximumSeamAngle}});}
    for(const auto& result:geometry.branches)valid=valid&&result.state==VesselBuildState::Built;
    if(geometry.junctions.size()!=1||!geometry.nativeShape||!valid)throw std::runtime_error((QString("Verification bifurcation failed: ")+ (geometry.junctions.empty()?"no junction":geometry.junctions.front().message)).toStdString());
    for(auto& set:model.pointSets)set.hidden=true;
    document_=model;path_=directory+"/symmetric-bifurcation.mvcad";undo_->clear();selected_=-1;selectedBody_.clear();rebuild(true);if(!waitForBuild())throw std::runtime_error("Background verification build failed.");
    viewport_->setCenterlines(false);viewport_->frontView();viewport_->clearGeometrySelection();statusBar()->clearMessage();
    mvcad::saveDocument(path_,document_);QApplication::processEvents();
    const auto rendering=viewport_->benchmarkRendering();viewport_->frontView();viewport_->repaint();
    if(!grab().save(directory+"/symmetric-bifurcation.png"))throw std::runtime_error("Could not save verification screenshot.");
    viewport_->setCenterlines(true);tree_->expandAll();QApplication::processEvents();if(!grab().save(directory+"/symmetric-centerlines.png"))throw std::runtime_error("Could not save guide screenshot.");
    viewport_->setCenterlines(false);
    QJsonObject report{{"reference","BifGeom_Clean: reference-inspired dimensions and outline, not an exact reconstruction"},{"mirrorOperation","Upper daughter reflected across Mother axis in XY; Z preserved"},{"motherDiameter",9},{"daughterDiameter",7.5},{"centerlineSymmetryError",symmetryError},{"coldBuildMs",cold},{"cachedBuildMs",warm},{"rendering",rendering},{"triangles",double(geometry.triangles.size())},{"volume",geometry.volume},{"junctions",junctions}};
    QFile output(directory+"/verification.json");if(!output.open(QIODevice::WriteOnly))throw std::runtime_error("Could not save verification report.");output.write(QJsonDocument(report).toJson());return true;
}

// Reproducible UI stress fixture. This measures many independent bodies and
// lazy point-tree population; connected junction timing is measured separately.
bool MainWindow::benchmarkLargeNetwork(const QString& directory){
    QDir().mkpath(directory);if(!waitForBuild())throw std::runtime_error("Pending build did not finish.");
    Document model;model.pointSets={{"Vessel endpoints",true},{"Additional imported points",true}};
    for(int i=0;i<1000;++i){
        const double x=(i%40)*28.,y=(i/40)*10.;
        const auto a=QString("A%1").arg(i),b=QString("B%1").arg(i);
        model.points.push_back({a,{x,y,0},"Vessel endpoints"});
        model.points.push_back({b,{x+20,y,0},"Vessel endpoints"});
        model.curveDefinitions.push_back({QString("Vessel %1").arg(i+1),{a,b},false});
    }
    for(int i=0;i<48000;++i)model.points.push_back({QString("Cloud %1").arg(i),{double(i%400),double(i/400),0},"Additional imported points"});
    QElapsedTimer clock;clock.start();regenerateCenterlines(model);const double topologyMs=clock.nsecsElapsed()/1e6;
    if(model.network.branches.size()!=1000)throw std::runtime_error("Large fixture did not generate 1000 branches.");
    for(auto& branch:model.network.branches)branch.diameter=2;
    precision_=1e-3;document_=std::move(model);path_.clear();selected_=-1;selectedBody_.clear();undo_->clear();
    int ticks=0;double maxGapMs=0;QElapsedTimer gap;gap.start();QTimer heartbeat;
    connect(&heartbeat,&QTimer::timeout,this,[&]{++ticks;maxGapMs=std::max(maxGapMs,gap.nsecsElapsed()/1e6);gap.restart();});heartbeat.start(10);
    clock.restart();rebuild(true);const double dispatchMs=clock.nsecsElapsed()/1e6;
    if(!waitForBuild()||!geometry_->nativeShape)throw std::runtime_error("Large geometry build failed.");
    const double readyMs=clock.nsecsElapsed()/1e6,coldKernelMs=lastBuildMs_;heartbeat.stop();
    if(ticks<3)throw std::runtime_error("UI event loop did not remain responsive during the large build.");
    for(const auto& branch:geometry_->branches)if(branch.state!=VesselBuildState::Built)throw std::runtime_error("A large-fixture branch failed.");
    int treeItems=0;for(QTreeWidgetItemIterator it(tree_);*it;++it)++treeItems;
    if(treeItems>2500)throw std::runtime_error("Point tree eagerly populated the large imported sets.");
    const auto triangles=geometry_->triangles.size();
    clock.restart();auto edit=document_.network;edit.branches[0].diameter=3;commit(edit,"Large fixture diameter edit");
    if(!waitForBuild())throw std::runtime_error("Large diameter edit failed.");
    const double editReadyMs=clock.nsecsElapsed()/1e6,editKernelMs=lastBuildMs_;
    const auto builds=builds_->buildCount();selectedBody_="vessels";clock.restart();bodyVisibility(true);bodyVisibility(false);
    const double visibilityMs=clock.nsecsElapsed()/1e6;
    if(builds_->busy()||builds_->buildCount()!=builds)throw std::runtime_error("Visibility unnecessarily rebuilt geometry.");
    selectedBody_.clear();viewport_->clearGeometrySelection();viewport_->setCenterlines(false);viewport_->frontView();QApplication::processEvents();
    const auto rendering=viewport_->benchmarkRendering();
    if(!grab().save(directory+"/large-network.png"))throw std::runtime_error("Could not save large network screenshot.");
    QJsonObject report{{"fixture","1000 independent straight bodies; 50000 imported points; not a connected-junction benchmark"},{"precision",precision_},{"bodies",1000},{"points",50000},{"topologyMs",topologyMs},{"dispatchMs",dispatchMs},{"coldKernelMs",coldKernelMs},{"coldUiReadyMs",readyMs},{"eventLoopHeartbeats",ticks},{"maximumHeartbeatGapMs",maxGapMs},{"diameterEditKernelMs",editKernelMs},{"diameterEditUiReadyMs",editReadyMs},{"visibilityToggleMs",visibilityMs},{"populatedTreeItems",treeItems},{"fineTriangles",double(triangles)},{"rendering",rendering}};
    QFile file(directory+"/large-network.json");if(!file.open(QIODevice::WriteOnly))throw std::runtime_error("Could not save benchmark report.");file.write(QJsonDocument(report).toJson());undo_->setClean();return true;
}
