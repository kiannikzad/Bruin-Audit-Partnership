import { Component, OnInit } from '@angular/core';
import { ApiService } from '../api.service';
import { SetupObjectService } from '../setup-object.service';
import {FormControl, Validators} from '@angular/forms';
import { AuthService } from '../auth.service';
import {MatPaginator, PageEvent} from '@angular/material/paginator';
import { ToastrService } from 'ngx-toastr';
import { Clipboard } from '@angular/cdk/clipboard'

@Component({
  selector: 'audit-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css']
})
export class AuditDashboard implements OnInit {

  constructor(
    private apiService: ApiService,
    private authService: AuthService,
    private setupObjectService: SetupObjectService,
    private toastr: ToastrService,
    private clipboard: Clipboard
  ) { }

  copyToClipboard(data: string) {
    this.clipboard.copy(data);
    this.toastr.success('Copied to clipboard')
  }

  
  ngOnInit(): void {
    this.getSetupObjects();
    this.getAudits();
    this.getSOPs();
  }

  managingOrganizationChange() {
    this.getAudits();
    this.getSOPs();
    this.managingOrganizationName = this.sessionObject.organizationFrontendName[this.sessionObject.organizationID.indexOf(this.managingOrganization)];
    this.role = this.sessionObject.role[this.sessionObject.organizationID.indexOf(this.managingOrganization)];
    this.supplemental = [];
  }
  
  sessionObject = this.authService.sessionObject;

  canViewPage = this.sessionObject.organizationID.length > 0;
  
  managingOrganization = this.canViewPage ? this.sessionObject.organizationID[0] : null;

  managingOrganizationName = this.sessionObject.organizationFrontendName[this.sessionObject.organizationID.indexOf(this.managingOrganization)];

  role = this.sessionObject.role[this.sessionObject.organizationID.indexOf(this.managingOrganization)];

  setupObject;
  setupFilterObject;
  allFeatures;
  allItems;
  uploadType = 'Observations';
  fieldsOptions = [];
  selectedFeature = 2; //Sink
  featuresOrItems = [];
  selectedFields = [];
  selectedSortField;
  filterBy = 'Ascending';

  onUploadTypeChange() {
    this.featuresOrItems = this.uploadType == 'Observations' ? this.allFeatures : this.allItems;
    this.selectedFeature = this.uploadType == 'Observations' ? 2 : 15;
    this.onFeatureSelectChange();
  }

  onFeatureSelectChange() {

  }

  getSetupObjects() {
    this.apiService.getSetupObject().subscribe((res) => {
      this.setupObject = res;
      this.parseSetupObject();
    });
  
    this.apiService.getSetupFilterObject().subscribe((res) => {
      this.setupFilterObject = res;
    })
  }

  parseSetupObject() {
    // get root features
    this.allFeatures = this.setupObject.features;
    this.allItems = this.setupObject.items;
    this.featuresOrItems = this.uploadType == 'Observations' ? this.allFeatures : this.allItems;
  }

  // Download spreadsheet template
  nRowsForm = new FormControl('500', [Validators.required, Validators.maxLength(5), Validators.pattern(/^[0-9]*$/)]);

  runDownload() {
    // if nRows is invalid then stop
    if(this.nRowsForm.invalid) return;
    const nRows = this.nRowsForm.value;
    const currentFeature = this.featuresOrItems[this.selectedFeature].frontendName;
    const currentUploadType = this.uploadType;

    this.apiService.getSpreadsheet(this.selectedFeature, this.uploadType === 'Items', nRows, this.managingOrganization).subscribe((res) => {
      this.blob = new Blob([res], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});

      var downloadURL = window.URL.createObjectURL(res);
      var link = document.createElement('a');
      link.href = downloadURL;
      link.download = `${currentFeature} ${currentUploadType} TDG Template.xlsx`
      link.click();

    }, (err) => {

    });
  }
  blob;

  // Upload spreadsheet template
  uploadSpreadsheet() {
    this.apiService.uploadSpreadsheet(this.selectedSpreadsheet, [], this.managingOrganization).subscribe((res) => {
      console.log(res);
    }, (err) => {
      console.log(err);
    })
  }

  cancelUploadSpreadsheet() {
    this.selectedSpreadsheet = null;
    this.isSpreadsheetExpanded = [false, false, false];
  }

  // Audits

  auditNameForm = new FormControl('', [Validators.required]);

  newAuditInitiated = false;
  auditName = "";
  auditCount = 0;
  auditArray: any = [];
  currentPageSize = 5;
  currentPageIndex = 0;
  fittedAuditArray = this.auditArray.slice((this.currentPageSize * this.currentPageIndex), (this.currentPageSize * (this.currentPageIndex + 1)));
  
  onPageChange(event: PageEvent): PageEvent {
    // update page data
    this.currentPageSize = event.pageSize;
    this.currentPageIndex = event.pageIndex;
    // refresh API
    this.fittedAuditArray = this.auditArray.slice((this.currentPageSize * this.currentPageIndex), (this.currentPageSize * (this.currentPageIndex + 1)));
    return event;
  }

  initiateNewAudit(open) {
    this.newAuditInitiated = open;
  }

  uploadNewAudit() {
    this.newAuditInitiated = false;
    this.apiService.uploadNewAudit(this.auditName, this.managingOrganization, this.sessionObject.userID).subscribe((res) => {
      this.getAudits();
    })
  }

  getAudits() {
    this.apiService.getAuditManagementTable(this.managingOrganization).subscribe((res) => {
      console.log(res)
      const json = JSON.parse(res);
      this.auditArray = json.audits;
      this.fittedAuditArray = this.auditArray.slice((this.currentPageSize * this.currentPageIndex), (this.currentPageSize * (this.currentPageIndex + 1)));
      this.auditCount = json.count;
    }, (err) => {
      console.log(err)
    })
  }

  // SOPs

  SOPArray: any = [];
  newSOPInitiated = false;
  SOPCount = 0;
  currentSOPPageSize = 5;
  currentSOPPageIndex = 0;
  SOPSignedUrl;
  selectedFile = null;
  selectedSpreadsheet = null;
  fittedSOPArray = this.SOPArray.slice((this.currentSOPPageSize * this.currentSOPPageIndex), (this.currentSOPPageSize * (this.currentSOPPageIndex + 1)));
  signedUrlObject = null;
  
  SOPName: string = '';
  SOPNameForm = new FormControl('', [Validators.required]);
  SOPUpload;

  onSOPPageChange(event: PageEvent): PageEvent {
    // update page data
    this.currentSOPPageSize = event.pageSize;
    this.currentSOPPageIndex = event.pageIndex;
    // refresh API
    this.fittedSOPArray = this.SOPArray.slice((this.currentSOPPageSize * this.currentSOPPageIndex), (this.currentSOPPageSize * (this.currentSOPPageIndex + 1)));
    return event;
  }


  initiateNewSOP(open) {
    if(open) {
      this.newSOPInitiated = true;
    } else {
      this.newSOPInitiated = false; 
      this.selectedFile = null;
      this.SOPName = '';
    }
  }

  isSpreadsheetExpanded = [false, false, false];

  uploadSOPToBucket() {
    this.newSOPInitiated = false;
    const currentName = this.SOPName;
    const currentSelectedFile = this.selectedFile;
    this.apiService.getSignedUrl({
      organizationID: this.managingOrganization,
      fileName: currentSelectedFile.name,
      type: currentSelectedFile.type,
    }).subscribe((res) => {
      console.log(JSON.parse(res))
      this.signedUrlObject = JSON.parse(res);
      this.apiService.putFileToBucket({
        url: this.signedUrlObject.signedURL,
        contentType: currentSelectedFile.type,
        asset: currentSelectedFile
      }).subscribe((res) => {
        // success
        console.log(res);
        this.apiService.uploadSOP({
          dataURL: this.signedUrlObject.dataURL,
          name: currentName,
          organizationID: this.managingOrganization
        }).subscribe((res) => {
          console.log(res);
          this.getSOPs();
          this.selectedFile = null;
          this.SOPName = '';
  
        }, (err) => {
          console.log(err)
        });
  
      }, (err) => {
        // fail
        console.log(err)
  
      })
    }, (err) => {
      console.log(err)
    })
    
  }

  fileUploadChange(fileInputEvent: any) {
    this.selectedFile = fileInputEvent.target.files[0];
    console.log(this.selectedFile)
  }

  async openInitially() {
    await new Promise(r => setTimeout(r, 100));
    this.isSpreadsheetExpanded = [true, true, true];
  }

  spreadsheetUploadChange(fileInputEvent: any) {
    this.selectedSpreadsheet = fileInputEvent.target.files[0];
    console.log(this.selectedSpreadsheet);
    this.openInitially();
  }

  supplemental = [];
  selectingDocument = false

  addSupplement(sop) {
    this.supplemental.push(sop)
    this.toastr.info('Document ' + sop.name + ' added')
    console.log(this.supplemental)
  }

  formatBytes(a,b=2,k=1024) {let d=Math.floor(Math.log(a)/Math.log(k));return 0==a?"0 Bytes":parseFloat((a/Math.pow(k,d)).toFixed(Math.max(0,b)))+" "+["Bytes","KB","MB","GB","TB","PB","EB","ZB","YB"][d]}

  formatEpoch(t) {return (new Date(t)).toLocaleString()}

  getSOPs() {
    this.apiService.getSOPTable(this.managingOrganization).subscribe((res) => {
      console.log(res)
      this.SOPArray = JSON.parse(res);
      this.fittedSOPArray = this.SOPArray.slice((this.currentSOPPageSize * this.currentSOPPageIndex), (this.currentSOPPageSize * (this.currentSOPPageIndex + 1)));
      this.SOPCount = this.SOPArray.length;
    }, (err) => {
      console.log(err)
    })
  }

  /* API KEY */
  newKey = false;
  newKeyValue = null;
  deleteSuccess = null;
  regenerating = false;
  deleting = false;

  initRegenerateAPIKey() {
    this.regenerating = true;
  }

  initDeleteAPIKey() {
    this.deleting = true
  }

  generateAPIKey() {
    this.apiService.putApiKey().subscribe((res: any) => {
      const newSessionObject = Object.assign({}, this.sessionObject);
      newSessionObject.isApiKeySet = true;
      this.authService.setSession(JSON.stringify(newSessionObject));
      this.sessionObject = this.authService.sessionObject;
      this.toastr.success('New API key successfully generated');
      this.regenerating = false;
      this.newKey = true;
      this.newKeyValue = res.key;      
    }, (err) => {
      console.log(err);
    })
  }

  deleteAPIKey() {
    this.apiService.deleteApiKey().subscribe((res) => {
      this.deleteSuccess = true;
      const newSessionObject = Object.assign({}, this.sessionObject);
      newSessionObject.isApiKeySet = false;
      this.authService.setSession(JSON.stringify(newSessionObject));
      this.sessionObject = this.authService.sessionObject;
      this.deleting = false;
      this.toastr.success('API key successfully deleted');
    }), (err) => {
      console.log(err);
    }
  }
}
