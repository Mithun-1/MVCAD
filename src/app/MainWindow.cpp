#include "MainWindow.h"
#include "Viewport.h"
#include "core/PartIO.h"
#include <QAction>
#include <QApplication>
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
    mvcad::Network before_,after_;
    std::function<void(const mvcad::Network&)> apply_;
public:
    Change(mvcad::Network before,mvcad::Network after,std::function<void(const mvcad::Network&)> apply,const QString& text)
      :QUndoCommand(text),before_(std::move(before)),after_(std::move(after)),apply_(std::move(apply)){}
    void undo()override{apply_(before_);}
    void redo()override{apply_(after_);}
};
}
MainWindow::MainWindow() {
    resize(1440,960);setMinimumSize(850,600);setObjectName("mainWindow");
    undo_=new QUndoStack(this);undo_->setUndoLimit(50);
    auto* body=new QWidget;auto* layout=new QVBoxLayout(body);layout->setContentsMargins(0,0,0,0);layout->setSpacing(0);
    setCentralWidget(body);
    viewport_=new Viewport;
    createCommands();
    auto* split=new QSplitter;split->setObjectName("workspaceSplitter");split->setChildrenCollapsible(false);
    layout->addWidget(split,1);
    createSidebar();
    auto* side=parameters_->parentWidget();split->addWidget(side);split->addWidget(viewport_);split->setSizes({270,1170});split->setStretchFactor(1,1);
    connect(viewport_,&Viewport::branchSelected,this,&MainWindow::selectBranch);
    connect(undo_,&QUndoStack::cleanChanged,this,[this]{updateTitle();});
    summary_=new QLabel;statusBar()->addWidget(summary_);statusBar()->addPermanentWidget(new QLabel("Development preview  |  Dimensionless"));
    setStyleSheet(R"(
        QMainWindow, QMenuBar, QStatusBar {background:#f7f9fc;color:#26354a;}
        QToolBar {background:#f8fafc;border:0px;spacing:6px;padding:3px;}
        QToolButton {padding:5px 8px;border:1px solid transparent;border-radius:2px;color:#243247;}
        QToolButton:hover {background:#e4effb;border-color:#b9d5f0;}
        QToolButton:disabled {color:#9ca7b3;}
        QTabBar::tab {background:#f0f3f7;border:1px solid #dae1e9;padding:4px 17px;min-height:16px;}
        QTabBar::tab:selected {background:#fff;color:#1268b8;border-bottom:2px solid #1684d5;}
        QTreeWidget {background:white;border:0px;color:#253246;}
        QTreeWidget::item {height:23px;}
        QTreeWidget::item:selected {background:#dceefe;color:#174a79;}
        QGroupBox {border:0px;border-top:1px solid #dbe3ec;margin-top:14px;padding-top:12px;font-weight:600;}
        QGroupBox::title {subcontrol-origin:margin;left:8px;}
        QLabel {color:#334359;}
        QDoubleSpinBox {background:white;padding:4px;border:1px solid #cbd5e1;min-height:20px;}
        QPushButton {background:#f6f8fb;border:1px solid #c7d2df;padding:6px 12px;border-radius:3px;}
        QPushButton:hover {background:#e2eefb;}
        QPushButton#applyDiameter {background:#1675ce;border-color:#1675ce;color:white;}
        QPushButton:disabled {color:#9ca7b3;background:#edf1f5;}
        QSplitter::handle {background:#dce3eb;width:2px;}
    )");
    rebuild(true);
}
void MainWindow::createCommands() {
    auto* file=menuBar()->addMenu("&File");
    file->addAction("&New Part",QKeySequence::New,this,&MainWindow::newPart);
    file->addAction("&Open Part…",QKeySequence::Open,this,&MainWindow::openDialog);
    file->addAction("&Save Part",QKeySequence::Save,this,[this]{save();});
    file->addAction("Save Part &As…",QKeySequence::SaveAs,this,[this]{save(true);});
    file->addSeparator();file->addAction("Import Centerlines (CSV)…",this,&MainWindow::importCsv);
    file->addAction("Open Example",this,&MainWindow::openExample);
    auto* exportAction=file->addAction("Export STEP…");exportAction->setEnabled(false);exportAction->setToolTip("Available after CAD kernel and STEP round-trip validation.");
    file->addSeparator();file->addAction("Exit",QKeySequence::Quit,this,&QWidget::close);
    auto* edit=menuBar()->addMenu("&Edit");
    auto* undo=undo_->createUndoAction(this,"Undo");undo->setShortcut(QKeySequence::Undo);edit->addAction(undo);
    auto* redo=undo_->createRedoAction(this,"Redo");redo->setShortcut(QKeySequence::Redo);edit->addAction(redo);
    auto* view=menuBar()->addMenu("&View");
    view->addAction("Fit All",QKeySequence("F"),viewport_,&Viewport::fitAll);
    view->addAction("Front",viewport_,&Viewport::frontView);view->addAction("Isometric",viewport_,&Viewport::isometricView);
    auto* labels=view->addAction("Show branch labels");labels->setCheckable(true);connect(labels,&QAction::toggled,viewport_,&Viewport::setLabels);
    auto* centerlines=view->addAction("Show centerlines through sweeps");centerlines->setCheckable(true);connect(centerlines,&QAction::toggled,viewport_,&Viewport::setCenterlines);
    auto* clear=view->addAction("Clear selection");clear->setShortcut(Qt::Key_Escape);connect(clear,&QAction::triggered,this,[this]{selectBranch(-1);});
    auto* help=menuBar()->addMenu("&Help");
    help->addAction("Development roadmap",this,[]{QDesktopServices::openUrl(QUrl("https://github.com/Mithun-1/MVCAD/blob/main/docs/ROADMAP.md"));});
    help->addAction("About MVCAD",this,[this]{QMessageBox::about(this,"MVCAD",QString("MVCAD %1\nNative microvascular geometry editor\n\nThis build imports centerlines, splits branches, previews diameters and saves editable part data. Preview meshes are not CAD solids. Junction construction, sketch constraints and STEP export are under development.").arg(MVCAD_VERSION));});
    auto* quick=addToolBar("File");quick->setMovable(false);quick->setIconSize(QSize(17,17));
    quick->addAction(style()->standardIcon(QStyle::SP_FileIcon),"New",this,&MainWindow::newPart);
    quick->addAction(style()->standardIcon(QStyle::SP_DirOpenIcon),"Open",this,&MainWindow::openDialog);
    quick->addAction(style()->standardIcon(QStyle::SP_DialogSaveButton),"Save Part",this,[this]{save();});
    quick->addSeparator();quick->addAction(undo);quick->addAction(redo);
    auto* space=new QWidget;space->setSizePolicy(QSizePolicy::Expanding,QSizePolicy::Preferred);quick->addWidget(space);
    quick->addWidget(new QLabel("MVCAD  "));quick->addAction(exportAction);
    commands_=new QStackedWidget;commands_->setFixedHeight(72);
    tabs_=new QTabBar;tabs_->setExpanding(false);tabs_->setDrawBase(false);
    auto* layout=qobject_cast<QVBoxLayout*>(centralWidget()->layout());layout->addWidget(commands_);layout->addWidget(tabs_);
    struct Command{QString text;std::function<void()> callback;};
    auto page=[&](QString name,std::vector<Command> list){
        auto* area=new QScrollArea;area->setWidgetResizable(true);area->setFrameShape(QFrame::NoFrame);
        area->setVerticalScrollBarPolicy(Qt::ScrollBarAlwaysOff);area->setHorizontalScrollBarPolicy(Qt::ScrollBarAsNeeded);
        auto* content=new QWidget;auto* h=new QHBoxLayout(content);h->setContentsMargins(8,3,8,3);h->setSpacing(3);
        for(auto& c:list){
            auto* button=new QToolButton;button->setText(c.text);button->setMinimumHeight(49);button->setToolButtonStyle(Qt::ToolButtonTextOnly);
            QFont f=font();f.setPointSize(9);button->setFont(f);
            if(c.callback)connect(button,&QToolButton::clicked,this,c.callback);
            else{button->setEnabled(false);button->setToolTip("Planned for v1.0. Not implemented in this development build.");}
            h->addWidget(button);
        }
        h->addStretch();content->setMinimumWidth(content->sizeHint().width());area->setWidget(content);commands_->addWidget(area);tabs_->addTab(name);
    };
    page("Features",{{"Extruded\nBoss/Base",{}},{"Revolved\nBoss/Base",{}},{"Swept\nBoss/Base",{}},{"Swept\nBlend",{}},
        {"Extruded\nCut",{}},{"Revolved\nCut",{}},{"Swept\nCut",{}},{"Swept Blend\nCut",{}},{"Round /\nFillet",{}},{"Remove\nFace",{}},
        {"Mirror\nBodies",{}},{"Linear\nPattern",{}},{"Circular\nPattern",{}},{"Reference\nGeometry",{}}});
    page("Sketch",{{"New\nSketch",{}},{"Smart\nDimension",{}},{"Line /\nCenterline",{}},{"Rectangle /\nCircle",{}},{"Arc /\nSpline",{}},
        {"Ellipse /\nPolygon",{}},{"Slot /\nPoint",{}},{"Trim /\nExtend",{}},{"Offset /\nConvert",{}},{"Mirror\nEntities",{}},{"Sketch\nPattern",{}},{"Add\nRelation",{}}});
    page("Centerlines",{{"Import\nPoints",[this]{importCsv();}},{"Open\nExample",[this]{openExample();}},{"Fit\nAll",[this]{viewport_->fitAll();}},
        {"Isometric\nView",[this]{viewport_->isometricView();}},{"Front\nView",[this]{viewport_->frontView();}},{"Edit\nSpline",{}}});
    page("Auto Sweep",{{"Assign\nDiameter",[this]{if(selected_>=0){diameter_->setFocus();diameter_->selectAll();}else statusBar()->showMessage("Select a branch in the viewport or tree.",5000);}},
        {"Clear\nDiameter",[this]{if(selected_>=0){auto n=network_;n.branches[selected_].diameter=0;commit(n,"Clear diameter");}}},
        {"Fit\nAll",[this]{viewport_->fitAll();}},{"Build\nJunctions",{}},{"Round\nJunction",{}}});
    connect(tabs_,&QTabBar::currentChanged,commands_,&QStackedWidget::setCurrentIndex);
    tabs_->setCurrentIndex(2);
}
void MainWindow::createSidebar() {
    auto* side=new QWidget;side->setObjectName("sidebar");side->setMinimumWidth(235);side->setMaximumWidth(460);side->setStyleSheet("QWidget#sidebar {background:#f8fafc;}");
    auto* v=new QVBoxLayout(side);v->setContentsMargins(9,8,9,8);v->setSpacing(8);
    auto* title=new QLabel("Feature History");QFont f=font();f.setWeight(QFont::DemiBold);title->setFont(f);v->addWidget(title);
    tree_=new QTreeWidget;tree_->setHeaderHidden(true);tree_->setIndentation(17);tree_->setSelectionMode(QAbstractItemView::SingleSelection);v->addWidget(tree_,1);
    connect(tree_,&QTreeWidget::itemSelectionChanged,this,[this]{if(rebuilding_)return;auto* i=tree_->currentItem();selectBranch(i&&i->data(0,Qt::UserRole).isValid()?i->data(0,Qt::UserRole).toInt():-1);});
    parameters_=new QGroupBox("Auto Sweep",side);auto* form=new QFormLayout(parameters_);form->setContentsMargins(3,16,3,3);
    selection_=new QLabel("Select a branch");form->addRow(selection_);
    diameter_=new QDoubleSpinBox;diameter_->setObjectName("diameterInput");diameter_->setDecimals(9);diameter_->setRange(.000000001,1e9);diameter_->setValue(6);diameter_->setSingleStep(.5);
    start_=new QDoubleSpinBox;end_=new QDoubleSpinBox;
    for(auto* s:{start_,end_}){s->setDecimals(3);s->setRange(0,99.999);s->setValue(10);s->setSuffix(" %");}
    form->addRow("Diameter",diameter_);form->addRow("Start setback",start_);form->addRow("End setback",end_);
    auto* hint=new QLabel("Junction ends only.\nFree endpoints extend fully.");hint->setStyleSheet("color:#67788b;font-size:11px;");form->addRow(hint);
    apply_=new QPushButton("Apply Diameter");apply_->setObjectName("applyDiameter");connect(apply_,&QPushButton::clicked,this,&MainWindow::applyDiameter);form->addRow(apply_);v->addWidget(parameters_);
    auto* group=new QGroupBox("Junctions");auto* j=new QVBoxLayout(group);junctions_=new QLabel("No junctions");junctions_->setWordWrap(true);junctions_->setTextFormat(Qt::PlainText);j->addWidget(junctions_);v->addWidget(group);
    auto* note=new QLabel("Sweep preview only\nJunction solids and STEP export are under development.");note->setWordWrap(true);note->setStyleSheet("color:#7b6340;font-size:11px;padding:5px 0;");v->addWidget(note);
}
void MainWindow::rebuild(bool fit) {
    rebuilding_=true;QSignalBlocker blocker(tree_);tree_->clear();
    auto* root=new QTreeWidgetItem(tree_,{path_.isEmpty()?"Untitled Part":QFileInfo(path_).completeBaseName()});root->setExpanded(true);
    auto* refs=new QTreeWidgetItem(root,{"Reference planes"});
    for(const auto& s:{"Front","Top","Right"})new QTreeWidgetItem(refs,{s});
    auto* points=new QTreeWidgetItem(root,{QString("Imported curves (%1)").arg(network_.curves.size())});
    for(const auto& c:network_.curves)new QTreeWidgetItem(points,{c.id});
    auto* branches=new QTreeWidgetItem(root,{QString("Branches (%1)").arg(network_.branches.size())});branches->setExpanded(true);
    for(int i=0;i<static_cast<int>(network_.branches.size());++i){
        const auto& b=network_.branches[i];
        auto* item=new QTreeWidgetItem(branches,{b.diameter>0?QString("%1   Ø%2").arg(b.id).arg(b.diameter,0,'g',10):b.id+"   Unassigned"});
        item->setData(0,Qt::UserRole,i);if(i==selected_)tree_->setCurrentItem(item);
    }
    auto states=mvcad::junctionStates(network_);QStringList lines;
    for(const auto& state:states)lines<<QString("J%1: %2/%3 diameters · %4").arg(lines.size()+1).arg(state.assigned).arg(state.incident).arg(state.assigned==state.incident?"awaiting build":"incomplete");
    junctions_->setText(lines.isEmpty()?"No junctions":lines.join('\n'));
    viewport_->setNetwork(network_,fit);rebuilding_=false;selectBranch(selected_);
    if(summary_)summary_->setText(QString("%1 branches  ·  %2 components  |  Drag to orbit · Wheel to zoom").arg(network_.branches.size()).arg(network_.components));
    updateTitle();
}
void MainWindow::selectBranch(int i) {
    if(i<0||i>=static_cast<int>(network_.branches.size()))i=-1;
    selected_=i;viewport_->setSelected(i);parameters_->setEnabled(i>=0);
    if(i<0){selection_->setText("Select a branch");QSignalBlocker block(tree_);tree_->clearSelection();return;}
    const auto& b=network_.branches[i];selection_->setText(b.id+(b.diameter>0?" · Sweep preview":" · Unassigned"));
    diameter_->setValue(b.diameter>0?b.diameter:6);start_->setValue(b.startSetback*100);end_->setValue(b.endSetback*100);
    start_->setEnabled(network_.nodes[b.start].degree>2);end_->setEnabled(network_.nodes[b.end].degree>2);
    QSignalBlocker block(tree_);
    QTreeWidgetItemIterator it(tree_);for(;*it;++it)if((*it)->data(0,Qt::UserRole).isValid()&&(*it)->data(0,Qt::UserRole).toInt()==i){tree_->setCurrentItem(*it);break;}
}
void MainWindow::applyDiameter() {
    if(selected_<0)return;
    try{auto n=network_;mvcad::setBranchParameters(n,selected_,diameter_->value(),start_->value()/100,end_->value()/100);commit(n,"Assign diameter "+n.branches[selected_].id);}
    catch(const std::exception& e){QMessageBox::warning(this,"Invalid sweep parameters",e.what());}
}
void MainWindow::commit(const mvcad::Network& n,const QString& text){
    // Validate display geometry before mutating the document or its undo history.
    (void)mvcad::makePreview(n);
    undo_->push(new Change(network_,n,[this](const auto& state){restore(state);},text));
}
void MainWindow::restore(const mvcad::Network& n){network_=n;rebuild();}
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
    try{mvcad::savePart(filename,network_);path_=filename;undo_->setClean();rebuild();statusBar()->showMessage("Part saved",3000);return true;}
    catch(const std::exception& e){QMessageBox::critical(this,"Save failed",e.what());return false;}
}
void MainWindow::newPart(){if(!mayDiscard())return;network_={};path_.clear();selected_=-1;undo_->clear();rebuild(true);}
void MainWindow::openDialog(){auto p=QFileDialog::getOpenFileName(this,"Open MVCAD Part",{},"MVCAD part (*.mvcad)");if(!p.isEmpty())openPath(p);}
void MainWindow::openPath(const QString& path) {
    try{auto n=mvcad::loadPart(path);(void)mvcad::makePreview(n);if(!mayDiscard())return;network_=std::move(n);path_=path;selected_=-1;undo_->clear();rebuild(true);}
    catch(const std::exception& e){QMessageBox::critical(this,"Open failed",e.what());}
}
void MainWindow::openExample(){if(!mayDiscard())return;network_=mvcad::demoNetwork();path_.clear();selected_=-1;undo_->clear();rebuild(true);tabs_->setCurrentIndex(3);}
void MainWindow::importCsv() {
    const auto path=QFileDialog::getOpenFileName(this,"Import Centerlines — replaces current network (Undo available)",{},"Centerline CSV (*.csv);;All files (*)");if(path.isEmpty())return;
    bool ok=false;const auto tolerance=QInputDialog::getText(this,"Connection tolerance","Shared sampled points within this distance are connected.\nExpected CSV columns: curve_id,x,y,z\nTolerance (dimensionless):",QLineEdit::Normal,"0.000001",&ok);
    if(!ok)return;
    try{bool numeric=false;double t=tolerance.toDouble(&numeric);if(!numeric)throw std::runtime_error("Invalid tolerance.");
        QFile f(path);if(!f.open(QIODevice::ReadOnly))throw std::runtime_error(f.errorString().toStdString());
        if(f.size()>16*1024*1024)throw std::runtime_error("CSV exceeds 16 MB limit.");
        auto n=mvcad::buildNetwork(mvcad::parseCsv(f.readAll()),t);selected_=-1;commit(n,"Import centerlines");viewport_->fitAll();tabs_->setCurrentIndex(3);
        statusBar()->showMessage(QString("Imported %1 branches in %2 components. Connections require shared sampled points.").arg(n.branches.size()).arg(n.components),10000);
    }catch(const std::exception& e){QMessageBox::warning(this,"Import failed",e.what());}
}
void MainWindow::closeEvent(QCloseEvent* e){if(mayDiscard())e->accept();else e->ignore();}
bool MainWindow::smokeCheck() {
    openExample();selectBranch(1);diameter_->setValue(6.25);start_->setValue(15);applyDiameter();
    if(network_.branches.size()!=5||network_.branches[1].diameter!=6.25||viewport_->selected()!=1)return false;
    undo_->undo();if(network_.branches[1].diameter!=6)return false;
    undo_->redo();if(network_.branches[1].diameter!=6.25)return false;
    undo_->setClean();selectBranch(-1);viewport_->fitAll();return true;
}
