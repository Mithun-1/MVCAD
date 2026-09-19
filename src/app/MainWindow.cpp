#include "MainWindow.h"
#include "Viewport.h"
#include "core/DocumentEditing.h"
#include "CadIcons.h"
#include <QFrame>
#include <QLineEdit>
#include <QMenu>
#include "core/PartIO.h"
#include <QAction>
#include <QApplication>
#include <QElapsedTimer>
#include <QThread>
#include <QTimer>
#include <QSettings>
#include <QSet>
#include <QMap>
#include <algorithm>
#include <QTemporaryDir>
#include <QCloseEvent>
#include <QDesktopServices>
#include <QDoubleSpinBox>
#include <QFile>
#include <QFileDialog>
#include <QFileInfo>
#include <QFormLayout>
#include <QGroupBox>
#include <QHeaderView>
#include <QInputDialog>
#include <QJsonDocument>
#include <QLabel>
#include <QLineEdit>
#include <QMenuBar>
#include <QMessageBox>
#include <QPushButton>
#include <QScrollArea>
#include <QSignalBlocker>
#include <QSplitter>
#include <QStackedWidget>
#include <QStatusBar>
#include <QStyle>
#include <QTabBar>
#include <QToolBar>
#include <QToolButton>
#include <QTreeWidget>
#include <QUndoCommand>
#include <QUndoStack>
#include <QUrl>
#include <QVBoxLayout>
#include <functional>
#include <stdexcept>

namespace {
class Change final:public QUndoCommand {
    mvcad::Document before_,after_;
    std::function<void(const mvcad::Document&)> apply_;
public:
    Change(mvcad::Document before,mvcad::Document after,std::function<void(const mvcad::Document&)> apply,const QString& text)
      :QUndoCommand(text),before_(std::move(before)),after_(std::move(after)),apply_(std::move(apply)){}
    void undo()override{apply_(before_);}
    void redo()override{apply_(after_);}
};
}
MainWindow::MainWindow() {
    QSettings preferences;const double storedPrecision=preferences.value("display/precision",1e-3).toDouble();precision_=std::isfinite(storedPrecision)?std::clamp(storedPrecision,1e-4,1.0):1e-3;
    resize(1440,960);setMinimumSize(850,600);setObjectName("mainWindow");
    undo_=new QUndoStack(this);undo_->setUndoLimit(50);
    auto* body=new QWidget;auto* layout=new QVBoxLayout(body);layout->setContentsMargins(0,0,0,0);layout->setSpacing(0);
    setCentralWidget(body);
    viewport_=new Viewport;
    createCommands();
    auto* split=new QSplitter;split->setObjectName("workspaceSplitter");split->setChildrenCollapsible(false);
    layout->addWidget(split,1);
    createSidebar();
    auto* side=parameters_->parentWidget();split->addWidget(side);
    auto* geometryPanel=new QWidget;auto* geometryLayout=new QVBoxLayout(geometryPanel);geometryLayout->setContentsMargins(0,0,0,0);geometryLayout->setSpacing(0);
    auto* displayTools=new QToolBar;displayTools->setIconSize({16,16});displayTools->setStyleSheet("QToolBar{background:#fff;border-bottom:1px solid #e1e4e7;spacing:2px;padding:1px;}");
    displayTools->addAction(cadIcon("body"),"Isometric",viewport_,&Viewport::isometricView);displayTools->addAction(cadIcon("plane"),"Front",viewport_,&Viewport::frontView);displayTools->addAction(cadIcon("eye"),"Fit all",viewport_,&Viewport::fitAll);displayTools->addSeparator();
    displayTools->addAction(cadIcon("eye"),"Show all geometry",this,&MainWindow::showAllGeometry);
    geometryLayout->addWidget(displayTools);geometryLayout->addWidget(viewport_,1);split->addWidget(geometryPanel);split->setSizes({270,1170});split->setStretchFactor(1,1);
    connect(viewport_,&Viewport::bodySelected,this,&MainWindow::selectBody);
    connect(viewport_,&Viewport::branchSelected,this,&MainWindow::selectBranch);
    connect(viewport_,&Viewport::pointSelected,this,&MainWindow::selectPoint);
    builds_=new GeometryBuildQueue(this);
    builds_->completed=[this](const GeometryBuildQueue::Result& result){
        geometry_=result.geometry;buildError_=result.error;lastBuildMs_=result.milliseconds;
        refreshTree();viewport_->setDocument(document_,geometry_,precision_,fitWhenReady_);fitWhenReady_=false;
    };
    connect(undo_,&QUndoStack::cleanChanged,this,[this]{updateTitle();});
    summary_=new QLabel;statusBar()->addWidget(summary_);statusBar()->addPermanentWidget(new QLabel("Development preview  |  Dimensionless"));
    setStyleSheet(R"(
        QMainWindow, QMenuBar, QStatusBar {background:#f7f9fc;color:#26354a;}
        QToolBar {background:#f8fafc;border:0px;spacing:6px;padding:3px;}
        QToolButton {padding:3px 5px;border:1px solid transparent;border-radius:2px;color:#243247;}
        QToolButton:hover {background:#e4effb;border-color:#b9d5f0;}
        QToolButton:disabled {color:#9ca7b3;}
        QTabBar::tab {background:#f0f3f7;border:1px solid #dae1e9;padding:2px 12px;min-height:16px;}
        QTabBar::tab:selected {background:#fff;color:#1268b8;border-bottom:2px solid #1684d5;}
        QTreeWidget {background:white;border:0px;color:#253246;}
        QTreeWidget::item {height:21px;}
        QTreeWidget::item:selected {background:#dceefe;color:#174a79;}
        QGroupBox {border:0px;border-top:1px solid #dbe3ec;margin-top:14px;padding-top:12px;font-weight:600;}
        QGroupBox::title {subcontrol-origin:margin;left:8px;}
        QLabel {color:#334359;}
        QDoubleSpinBox {background:white;padding:4px;border:1px solid #cbd5e1;min-height:20px;}
        QPushButton {background:#f6f8fb;border:1px solid #c7d2df;padding:6px 12px;border-radius:3px;}
        QPushButton:hover {background:#e2eefb;}
        QPushButton#applyDiameter {background:#1675ce;border-color:#1675ce;color:white;}
        QPushButton#applyDiameter:disabled {background:#edf1f5;border-color:#c7d2df;color:#9ca7b3;}
        QPushButton:disabled {color:#9ca7b3;background:#edf1f5;}
        QSplitter::handle {background:#dce3eb;width:2px;}
    )");
    rebuild(true);
}
MainWindow::~MainWindow(){delete builds_;builds_=nullptr;}
void MainWindow::createCommands() {
    auto* file=menuBar()->addMenu("&File");
    file->addAction("&New Part",QKeySequence::New,this,&MainWindow::newPart);
    file->addAction("&Open Part…",QKeySequence::Open,this,&MainWindow::openDialog);
    file->addAction("&Save Part",QKeySequence::Save,this,[this]{save();});
    file->addAction("Save Part &As…",QKeySequence::SaveAs,this,[this]{save(true);});
    file->addSeparator();file->addAction("Import Points (CSV)…",this,&MainWindow::importCsv);
    file->addAction("Open Example",this,&MainWindow::openExample);
    auto* exportAction=file->addAction("Export STEP…");exportAction->setEnabled(false);exportAction->setToolTip("Available after CAD kernel and STEP round-trip validation.");
    file->addSeparator();file->addAction("Exit",QKeySequence::Quit,this,&QWidget::close);
    auto* edit=menuBar()->addMenu("&Edit");
    edit->addAction("Settings…",this,&MainWindow::settings);
    edit->addAction("Edit Centerline…",this,&MainWindow::editCenterline);
    auto* undo=undo_->createUndoAction(this,"Undo");undo->setShortcut(QKeySequence::Undo);edit->addAction(undo);
    auto* redo=undo_->createRedoAction(this,"Redo");redo->setShortcut(QKeySequence::Redo);edit->addAction(redo);
    auto* view=menuBar()->addMenu("&View");
    view->addAction("Fit All",QKeySequence("F"),viewport_,&Viewport::fitAll);
    view->addAction("Front",viewport_,&Viewport::frontView);view->addAction("Isometric",viewport_,&Viewport::isometricView);
    auto* labels=view->addAction("Show branch labels");labels->setCheckable(true);connect(labels,&QAction::toggled,viewport_,&Viewport::setLabels);
    auto* centerlines=view->addAction("Show centerlines through sweeps");centerlines->setCheckable(true);connect(centerlines,&QAction::toggled,viewport_,&Viewport::setCenterlines);connect(viewport_,&Viewport::centerlinesVisibilityChanged,centerlines,&QAction::setChecked);
    auto* clear=view->addAction("Clear selection");clear->setShortcut(Qt::Key_Escape);connect(clear,&QAction::triggered,this,[this]{selectBranch(-1);selectedBody_.clear();viewport_->clearGeometrySelection();statusBar()->clearMessage();});
    auto* help=menuBar()->addMenu("&Help");
    help->addAction("Development roadmap",this,[]{QDesktopServices::openUrl(QUrl("https://github.com/Mithun-1/MVCAD/blob/main/docs/ROADMAP.md"));});
    help->addAction("About MVCAD",this,[this]{QMessageBox::about(this,"MVCAD",QString("MVCAD %1\nNative microvascular geometry editor\n\nPoint sets, editable centerlines and automatic vessel sweeps. Exact branch solids and supported junction blends use Open CASCADE 7.9.3. Surface preparation and STEP export remain under development.").arg(MVCAD_VERSION));});
    undo->setIcon(style()->standardIcon(QStyle::SP_ArrowBack));redo->setIcon(style()->standardIcon(QStyle::SP_ArrowForward));
    auto* quick=addToolBar("File");quick->setMovable(false);quick->setIconSize(QSize(17,17));
    quick->addAction(style()->standardIcon(QStyle::SP_FileIcon),"New",this,&MainWindow::newPart);
    quick->addAction(style()->standardIcon(QStyle::SP_DirOpenIcon),"Open",this,&MainWindow::openDialog);
    quick->addAction(style()->standardIcon(QStyle::SP_DialogSaveButton),"Save Part",this,[this]{save();});
    quick->addSeparator();quick->addAction(undo);quick->addAction(redo);
    auto* space=new QWidget;space->setSizePolicy(QSizePolicy::Expanding,QSizePolicy::Preferred);quick->addWidget(space);
    quick->addWidget(new QLabel("MVCAD  "));quick->addAction(exportAction);
    commands_=new QStackedWidget;commands_->setFixedHeight(82);
    tabs_=new QTabBar;tabs_->setExpanding(false);tabs_->setDrawBase(false);
    auto* layout=qobject_cast<QVBoxLayout*>(centralWidget()->layout());layout->addWidget(commands_);layout->addWidget(tabs_);
    struct Command{QString text;std::function<void()> callback;};
    auto page=[&](QString name,std::vector<Command> list){
        auto* area=new QScrollArea;area->setWidgetResizable(true);area->setFrameShape(QFrame::NoFrame);
        area->setVerticalScrollBarPolicy(Qt::ScrollBarAlwaysOff);area->setHorizontalScrollBarPolicy(Qt::ScrollBarAsNeeded);
        auto* content=new QWidget;auto* h=new QHBoxLayout(content);h->setContentsMargins(8,3,8,3);h->setSpacing(3);
        for(auto& c:list){
            if(c.text=="|"){auto* separator=new QFrame;separator->setFrameShape(QFrame::VLine);separator->setStyleSheet("color:#d1d5d9");h->addWidget(separator);continue;}
            auto* button=new QToolButton;button->setText(c.text);button->setFixedSize(82,66);button->setIconSize({23,23});button->setIcon(cadIcon(c.text.toLower()));button->setToolButtonStyle(Qt::ToolButtonTextUnderIcon);button->setToolTip(c.text.simplified());
            QFont f=font();f.setPointSize(9);button->setFont(f);
            if(c.callback)connect(button,&QToolButton::clicked,this,c.callback);
            else{button->setEnabled(false);button->setToolTip("Planned for v1.0. Not implemented in this development build.");}
            h->addWidget(button);
        }
        h->addStretch();content->setMinimumWidth(content->sizeHint().width());area->setWidget(content);commands_->addWidget(area);tabs_->addTab(name);
    };
    page("Points",{{"Import\nPoint Sets",[this]{importCsv();}},{"New Point\nSet",[this]{newPointSet();}},{"Edit\nPoints",[this]{datumPoints();}},{"|",{}},{"Hide",[this]{entityVisibility(true);}},{"Show",[this]{entityVisibility(false);}},{"Show All",[this]{showAllGeometry();}}});
    page("Centerlines",{{"Curve Through\nPoints",[this]{curveThroughPoints();}},{"Edit\nCenterline",[this]{editCenterline();}},{"Mirror\nCenterline",[this]{mirrorCurve();}},{"|",{}},{"Hide",[this]{entityVisibility(true);}},{"Show",[this]{entityVisibility(false);}},{"Dependencies",[this]{showDependencies();}}});
    page("Auto Sweep",{{"Assign\nDiameter",[this]{if(selected_>=0){diameter_->setFocus();diameter_->selectAll();}else statusBar()->showMessage("Select a branch in the viewport or tree.",5000);}},
        {"Assign All\nUnassigned",[this]{assignAllDiameters();}},
        {"Clear\nDiameter",[this]{if(selected_>=0){auto n=document_.network;n.branches[selected_].diameter=0;commit(n,"Clear diameter");}}},
        {"Round\nJunctions",[this]{roundJunctions();}},{"|",{}},{"Hide\nBodies",[this]{selectedBody_="vessels";bodyVisibility(true);}},{"Show\nBodies",[this]{showAllBodies();}},{"Transparent",[this]{selectedBody_="vessels";bodyTransparency();}}});
    connect(tabs_,&QTabBar::currentChanged,commands_,&QStackedWidget::setCurrentIndex);
    tabs_->setCurrentIndex(0);
}
void MainWindow::createSidebar() {
    auto* side=new QWidget;side->setObjectName("sidebar");side->setMinimumWidth(235);side->setMaximumWidth(460);side->setStyleSheet("QWidget#sidebar {background:#f8fafc;}");
    auto* v=new QVBoxLayout(side);v->setContentsMargins(9,8,9,8);v->setSpacing(8);
    auto* title=new QLabel("Network History");QFont f=font();f.setWeight(QFont::DemiBold);title->setFont(f);v->addWidget(title);
    auto* filter=new QLineEdit;filter->setObjectName("featureTreeFilter");filter->setPlaceholderText("Filter network");filter->setClearButtonEnabled(true);v->addWidget(filter);
    tree_=new QTreeWidget;tree_->setHeaderHidden(true);tree_->setIndentation(17);tree_->setSelectionMode(QAbstractItemView::ExtendedSelection);v->addWidget(tree_,1);
    tree_->setIconSize({16,16});tree_->setContextMenuPolicy(Qt::CustomContextMenu);connect(tree_,&QWidget::customContextMenuRequested,this,&MainWindow::bodyMenu);
    connect(filter,&QLineEdit::textChanged,this,&MainWindow::filterTree);
    connect(tree_,&QTreeWidget::itemChanged,this,[this](QTreeWidgetItem* item,int){if(rebuilding_)return;
        if(item->data(0,Qt::UserRole+6).isValid()){selectedBody_=item->data(0,Qt::UserRole+6).toString();bodyVisibility(item->checkState(0)!=Qt::Checked);}
        else{tree_->setCurrentItem(item);entityVisibility(item->checkState(0)!=Qt::Checked);}});
    connect(tree_,&QTreeWidget::itemSelectionChanged,this,&MainWindow::handleTreeSelection);
    connect(tree_,&QTreeWidget::itemDoubleClicked,this,[this](QTreeWidgetItem*,int){if(selectedCurve_>=0)editCenterline();else if(!selectedPoints_.empty())datumPoints();});
    connect(tree_,&QTreeWidget::itemExpanded,this,&MainWindow::populateTreeItem);
    parameters_=new QGroupBox("Auto Sweep",side);auto* form=new QFormLayout(parameters_);form->setContentsMargins(3,16,3,3);
    selection_=new QLabel("Select a branch");form->addRow(selection_);
    diameter_=new QDoubleSpinBox;diameter_->setObjectName("diameterInput");diameter_->setDecimals(9);diameter_->setRange(.000000001,1e9);diameter_->setValue(6);diameter_->setSingleStep(.5);
    start_=new QDoubleSpinBox;end_=new QDoubleSpinBox;
    for(auto* s:{start_,end_}){s->setDecimals(3);s->setRange(0,99.999);s->setValue(10);s->setSuffix(" %");}
    form->addRow("Diameter",diameter_);form->addRow("Start setback",start_);form->addRow("End setback",end_);
    auto* hint=new QLabel("Junction ends only.\nFree endpoints extend fully.");hint->setStyleSheet("color:#67788b;font-size:11px;");form->addRow(hint);
    apply_=new QPushButton("Apply Diameter");apply_->setObjectName("applyDiameter");connect(apply_,&QPushButton::clicked,this,&MainWindow::applyDiameter);form->addRow(apply_);v->addWidget(parameters_);
    auto* group=new QGroupBox("Junctions");auto* j=new QVBoxLayout(group);junctions_=new QLabel("No junctions");junctions_->setWordWrap(true);junctions_->setTextFormat(Qt::PlainText);j->addWidget(junctions_);v->addWidget(group);
    buildStatus_=new QLabel;buildStatus_->setWordWrap(true);buildStatus_->setObjectName("geometryBuildStatus");v->addWidget(buildStatus_);
    auto* note=new QLabel("Import or create point sets to begin.");note->setObjectName("modelingNotice");note->setWordWrap(true);note->setStyleSheet("color:#7b6340;font-size:11px;padding:5px 0;");v->addWidget(note);
}
void MainWindow::filterTree(const QString& text) {
    std::function<bool(QTreeWidgetItem*)> show=[&](auto* item){
        bool matches=item->text(0).contains(text,Qt::CaseInsensitive);
        for(int i=0;i<item->childCount();++i)matches=show(item->child(i))||matches;
        item->setHidden(!matches);if(!text.isEmpty()&&matches)item->setExpanded(true);return matches;
    };
    for(int i=0;i<tree_->topLevelItemCount();++i)show(tree_->topLevelItem(i));
}
void MainWindow::rebuild(bool fit,bool geometryChanged){
    if(geometryChanged){geometry_.reset();buildError_.clear();fitWhenReady_=fitWhenReady_||fit;builds_->request(document_.network,precision_,document_.junctionRadius);}
    refreshTree();viewport_->setDocument(document_,geometry_,precision_,fit);
}
bool MainWindow::waitForBuild(int timeoutMs){
    QElapsedTimer timer;timer.start();while(builds_->busy()&&timer.elapsed()<timeoutMs){QApplication::processEvents(QEventLoop::AllEvents,20);QThread::msleep(1);}
    return !builds_->busy()&&buildError_.isEmpty()&&bool(geometry_);
}
void MainWindow::populateTreeItem(QTreeWidgetItem* parent){
    if(parent->childCount())return;QSignalBlocker blocker(tree_);
    auto pointItem=[&](int index){const auto& p=document_.points[index];auto* item=new QTreeWidgetItem(parent,{p.id});item->setIcon(0,cadIcon("point"));item->setData(0,Qt::UserRole+2,index);item->setCheckState(0,p.hidden?Qt::Unchecked:Qt::Checked);item->setToolTip(0,QString("X %1 · Y %2 · Z %3").arg(p.position.x).arg(p.position.y).arg(p.position.z));};
    if(parent->data(0,Qt::UserRole+8).isValid()){for(int index:pointGroups_.value(parent->data(0,Qt::UserRole+8).toString()))pointItem(index);}
    else if(parent->data(0,Qt::UserRole+5).isValid()){
        const auto id=document_.network.curves[parent->data(0,Qt::UserRole+5).toInt()].id;
        for(const auto& definition:document_.curveDefinitions)if(definition.id==id){
            if(!definition.mirrorSource.isEmpty()){new QTreeWidgetItem(parent,{"Source: "+definition.mirrorSource});new QTreeWidgetItem(parent,{"Axis: "+definition.mirrorAxis});}
            for(const auto& point:definition.pointIds)if(pointIndices_.contains(point))pointItem(pointIndices_[point]);break;
        }
    }
}
void MainWindow::refreshTree(){
    rebuilding_=true;QSignalBlocker blocker(tree_);QSet<QString> expanded;
    for(QTreeWidgetItemIterator it(tree_);*it;++it)if((*it)->isExpanded())expanded.insert((*it)->text(0));
    tree_->clear();pointGroups_.clear();pointIndices_.clear();
    for(int i=0;i<int(document_.points.size());++i){pointGroups_[document_.points[i].setId].push_back(i);pointIndices_[document_.points[i].id]=i;}
    auto* root=new QTreeWidgetItem(tree_,{path_.isEmpty()?"Untitled Part":QFileInfo(path_).completeBaseName()});root->setExpanded(true);root->setIcon(0,cadIcon("body"));
    auto item=[&](QTreeWidgetItem* parent,const QString& text,const QString& icon){auto* result=new QTreeWidgetItem(parent,{text});result->setIcon(0,cadIcon(icon));return result;};
    auto* bodies=item(root,"Vessel Bodies","folder");bodies->setExpanded(true);
    if(geometry_&&geometry_->nativeShape){auto* body=item(bodies,"Vessel network","body");body->setData(0,Qt::UserRole+6,"vessels");bool hidden=false;for(const auto& state:document_.bodyDisplay)if(state.bodyId=="vessels")hidden=state.hidden;body->setCheckState(0,hidden?Qt::Unchecked:Qt::Checked);}
    auto* cloud=item(root,QString("Points (%1)").arg(document_.points.size()),"folder");
    for(const auto& set:document_.pointSets){auto* child=item(cloud,QString("%1 (%2)").arg(set.id).arg(pointGroups_.value(set.id).size()),"folder");child->setData(0,Qt::UserRole+7,set.id);child->setData(0,Qt::UserRole+8,set.id);child->setCheckState(0,set.hidden?Qt::Unchecked:Qt::Checked);child->setChildIndicatorPolicy(QTreeWidgetItem::ShowIndicator);}
    if(pointGroups_.contains("")){auto* loose=item(cloud,QString("Ungrouped (%1)").arg(pointGroups_.value("").size()),"folder");loose->setData(0,Qt::UserRole+8,QString{});loose->setChildIndicatorPolicy(QTreeWidgetItem::ShowIndicator);}
    auto* curves=item(root,QString("Centerlines (%1)").arg(document_.network.curves.size()),"folder");
    for(int i=0;i<int(document_.network.curves.size());++i){const auto& curve=document_.network.curves[i];auto* child=item(curves,curve.id,"curve");child->setData(0,Qt::UserRole+5,i);child->setCheckState(0,std::find(document_.hiddenCurves.begin(),document_.hiddenCurves.end(),curve.id)==document_.hiddenCurves.end()?Qt::Checked:Qt::Unchecked);child->setChildIndicatorPolicy(QTreeWidgetItem::ShowIndicator);}
    auto* branches=item(root,QString("Branches (%1)").arg(document_.network.branches.size()),"folder");branches->setExpanded(document_.network.branches.size()<100);
    for(int i=0;i<int(document_.network.branches.size());++i){const auto& b=document_.network.branches[i];auto* child=item(branches,b.id+(b.diameter>0?QString("   Ø%1").arg(b.diameter,0,'g',10):"   Unassigned"),"sweep");child->setData(0,Qt::UserRole,i);if(geometry_&&i<int(geometry_->branches.size()))child->setToolTip(0,geometry_->branches[i].message);}
    for(QTreeWidgetItemIterator it(tree_);*it;++it)if(expanded.contains((*it)->text(0))){populateTreeItem(*it);(*it)->setExpanded(true);}
    int built=0,partial=0,failed=0;QStringList details;
    if(geometry_)for(const auto& j:geometry_->junctions){if(j.state==mvcad::VesselBuildState::Built)++built;else if(j.state==mvcad::VesselBuildState::Failed)++failed;else ++partial;if(details.size()<20)details<<QString("J%1: %2").arg(j.index+1).arg(j.message);}
    junctions_->setText(geometry_?QString("%1 joined · %2 provisional · %3 failed").arg(built).arg(partial).arg(failed):"Waiting for geometry");junctions_->setToolTip(details.join('\n'));
    buildStatus_->setText(!buildError_.isEmpty()?"Build failed: "+buildError_:!geometry_?"Building bodies… You can keep editing.":QString("Bodies ready · %1 ms").arg(lastBuildMs_,0,'f',0));
    parameters_->setVisible(!document_.network.branches.empty());junctions_->parentWidget()->setVisible(!document_.network.branches.empty());
    findChild<QLabel*>("modelingNotice")->setText(document_.network.branches.empty()?"Import or create point sets, then create a curve through the points.":"Select a branch and assign its diameter. Purple junctions are provisional; failed junctions remain separate branch solids.");
    rebuilding_=false;if(selected_>=int(document_.network.branches.size()))selected_=-1;
    if(!selectedBody_.isEmpty())selectBody(selectedBody_);else selectBranch(selected_);
    filterTree(findChild<QLineEdit*>("featureTreeFilter")->text());
    if(summary_)summary_->setText(QString("%1 points · %2 centerlines · %3 branches").arg(document_.points.size()).arg(document_.network.curves.size()).arg(document_.network.branches.size()));updateTitle();
}

void MainWindow::selectBranch(int i) {
    if(i<0||i>=static_cast<int>(document_.network.branches.size()))i=-1;
    if(i>=0){selectedBody_.clear();viewport_->clearGeometrySelection();}
    selected_=i;viewport_->setSelected(i);parameters_->setEnabled(i>=0);
    if(i<0){selection_->setText("Select a branch");QSignalBlocker block(tree_);tree_->clearSelection();return;}
    const auto& b=document_.network.branches[i];selection_->setText(b.id+(b.diameter>0?" · Circular sweep":" · Unassigned"));
    diameter_->setValue(b.diameter>0?b.diameter:6);start_->setValue(b.startSetback*100);end_->setValue(b.endSetback*100);
    start_->setEnabled(document_.network.nodes[b.start].degree>2);end_->setEnabled(document_.network.nodes[b.end].degree>2);
    QSignalBlocker block(tree_);
    QTreeWidgetItemIterator it(tree_);for(;*it;++it)if((*it)->data(0,Qt::UserRole).isValid()&&(*it)->data(0,Qt::UserRole).toInt()==i){tree_->setCurrentItem(*it);break;}
}
void MainWindow::applyDiameter() {
    if(selected_<0)return;
    try{auto n=document_.network;mvcad::setBranchParameters(n,selected_,diameter_->value(),start_->value()/100,end_->value()/100);commit(n,"Assign diameter "+n.branches[selected_].id);}
    catch(const std::exception& e){QMessageBox::warning(this,"Invalid sweep parameters",e.what());}
}
void MainWindow::commit(const mvcad::Network& n,const QString& text){
    // Only network parameters changed; the point/definition data is already
    // validated. Do not serialize tens of thousands of unchanged points.
    (void)mvcad::serializePart(n);auto d=document_;d.network=n;
    undo_->push(new Change(document_,std::move(d),[this](const auto& state){restore(state);},text));
}
void MainWindow::commit(const mvcad::Document& d,const QString& text){
    (void)mvcad::serializeDocument(d);
    if(!d.cad.sketches.empty()||!d.cad.features.empty())throw std::runtime_error("Classic sketch/modeling parts are not supported by this centerline workbench.");
    undo_->push(new Change(document_,d,[this](const auto& state){restore(state);},text));
}
void MainWindow::restore(const mvcad::Document& d){
    // Display edits must never request kernel work.
    const auto old=mvcad::serializePart(document_.network),next=mvcad::serializePart(d.network);
    const bool changed=old!=next||document_.junctionRadius!=d.junctionRadius;
    document_=d;if(selectedCurve_>=int(d.network.curves.size()))selectedCurve_=-1;rebuild(false,changed);
}
void MainWindow::updateTitle(){setWindowTitle(QString("MVCAD — %1%2  [%3]").arg(path_.isEmpty()?"Untitled Part":QFileInfo(path_).fileName()).arg(undo_->isClean()?"":" *").arg(MVCAD_VERSION));}
bool MainWindow::mayDiscard() {
    if(undo_->isClean())return true;
    auto answer=QMessageBox::question(this,"Save changes?","Save the current part before continuing?",QMessageBox::Save|QMessageBox::Discard|QMessageBox::Cancel,QMessageBox::Save);
    return answer==QMessageBox::Discard||(answer==QMessageBox::Save&&save());
}
bool MainWindow::save(bool as) {
    auto filename=path_;
    if(filename.isEmpty()||as)filename=QFileDialog::getSaveFileName(this,"Save MVCAD Part",filename.isEmpty()?"Untitled.mvcad":filename,"MVCAD part (*.mvcad)");
    if(filename.isEmpty())return false;
    if(!filename.endsWith(".mvcad",Qt::CaseInsensitive))filename+=".mvcad";
    try{mvcad::saveDocument(filename,document_);path_=filename;undo_->setClean();rebuild(false,false);statusBar()->showMessage("Part saved",3000);return true;}
    catch(const std::exception& e){QMessageBox::critical(this,"Save failed",e.what());return false;}
}
void MainWindow::newPart(){if(!mayDiscard())return;document_={};path_.clear();selected_=selectedCurve_=-1;selectedBody_.clear();selectedPoints_.clear();viewport_->clearGeometrySelection();undo_->clear();rebuild(true);tabs_->setCurrentIndex(0);}

void MainWindow::openDialog(){auto p=QFileDialog::getOpenFileName(this,"Open MVCAD Part",{},"MVCAD part (*.mvcad)");if(!p.isEmpty())openPath(p);}
void MainWindow::openPath(const QString& path){
    try{auto d=mvcad::loadDocument(path);if(!d.cad.sketches.empty()||!d.cad.features.empty())throw std::runtime_error("This part contains classic CAD sketches or features. Use the previous MVCAD version to open it; the centerline workbench will not discard them.");if(!mayDiscard())return;document_=std::move(d);path_=path;selected_=selectedCurve_=-1;selectedBody_.clear();selectedPoints_.clear();viewport_->clearGeometrySelection();undo_->clear();rebuild(true);}
    catch(const std::exception& e){QMessageBox::critical(this,"Open failed",e.what());}
}

void MainWindow::openExample(){
    if(!mayDiscard())return;document_={};document_.network=mvcad::buildNetwork({{"Mother",{{-30,0,0},{0,0,0}}},{"Daughter 1",{{0,0,0},{30,30,0}}},{"Daughter 2",{{0,0,0},{30,-30,0}}}});
    for(int i=0;i<int(document_.network.branches.size());++i){auto& b=document_.network.branches[i];b.diameter=i==0?8:6;b.startSetback=b.endSetback=.3;}
    mvcad::ensureCurveDefinitions(document_);for(auto& p:document_.points)p.hidden=true;
    path_.clear();selected_=selectedCurve_=-1;selectedBody_.clear();selectedPoints_.clear();viewport_->clearGeometrySelection();undo_->clear();rebuild(true);tabs_->setCurrentIndex(2);
}

void MainWindow::importCsv() {
    const auto paths=QFileDialog::getOpenFileNames(this,"Import Point Sets",{},"CSV points (*.csv)");if(paths.isEmpty())return;
    try{auto d=document_;for(const auto& path:paths){QFile file(path);if(!file.open(QIODevice::ReadOnly))throw std::runtime_error(file.errorString().toStdString());if(file.size()>16*1024*1024)throw std::runtime_error("CSV exceeds 16 MB.");
        const auto imported=mvcad::parsePointsCsv(file.readAll());const auto base=QFileInfo(path).completeBaseName();QString name=base;int n=2;
        while(std::any_of(d.pointSets.begin(),d.pointSets.end(),[&](const auto& set){return set.id==name;}))name=base+QString("_%1").arg(n++);
        mvcad::appendPointSet(d,name,imported);
    }commit(d,"Import point sets");viewport_->setCenterlines(true);viewport_->fitAll();tabs_->setCurrentIndex(0);statusBar()->showMessage("Point sets imported. Select points or a set, then Curve Through Points.",10000);
    }catch(const std::exception& e){QMessageBox::warning(this,"Import failed",e.what());}
}

void MainWindow::closeEvent(QCloseEvent* e){if(mayDiscard())e->accept();else e->ignore();}
bool MainWindow::smokeCheck(){
    if(tabs_->count()!=3||tabs_->tabText(0)!="Points"||tabs_->tabText(1)!="Centerlines"||tabs_->tabText(2)!="Auto Sweep")return false;
    if(!dialogSmokeCheck()||!waitForBuild())return false;undo_->setClean();openExample();
    int heartbeats=0;QTimer heartbeat;connect(&heartbeat,&QTimer::timeout,this,[&]{++heartbeats;});heartbeat.start(5);
    if(!waitForBuild()||!geometry_->nativeShape||heartbeats<2)return false;heartbeat.stop();
    selectBranch(0);auto edited=document_.network;edited.branches[0].diameter=9;commit(edited,"Smoke diameter");
    edited.branches[0].diameter=10;commit(edited,"Smoke latest diameter");
    if(!waitForBuild()||document_.network.branches[0].diameter!=10||!geometry_->nativeShape)return false;
    undo_->undo();if(!waitForBuild()||document_.network.branches[0].diameter!=9)return false;
    undo_->redo();if(!waitForBuild()||document_.network.branches[0].diameter!=10)return false;
    const auto builds=builds_->buildCount();selectedBody_="vessels";bodyVisibility(true);bodyTransparency();bodyVisibility(false);
    QApplication::processEvents();if(builds_->busy()||builds_->buildCount()!=builds)return false;
    if(document_.bodyDisplay.empty()||document_.bodyDisplay.front().hidden||document_.bodyDisplay.front().opacity>=1)return false;
    undo_->undo();if(!document_.bodyDisplay.front().hidden)return false;undo_->redo();if(document_.bodyDisplay.front().hidden||builds_->buildCount()!=builds)return false;
    auto next=document_;mvcad::appendPointSet(next,"Manual",{{"Extra",{50,0,0}}});commit(next,"Smoke point set");
    if(builds_->busy()||document_.pointSets.size()!=1)return false;
    auto* cloud=tree_->topLevelItem(0)->child(1);cloud->setExpanded(true);QApplication::processEvents();
    QTemporaryDir temporary;auto filename=temporary.filePath("smoke.mvcad");mvcad::saveDocument(filename,document_);
    if(mvcad::serializeDocument(mvcad::loadDocument(filename))!=mvcad::serializeDocument(document_))return false;
    undo_->setClean();selectedBody_="vessels";bodyTransparency();undo_->setClean();selectedBody_.clear();viewport_->clearGeometrySelection();selectBranch(-1);viewport_->fitAll();return true;
}
