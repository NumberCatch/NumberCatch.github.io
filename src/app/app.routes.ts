import { Routes } from '@angular/router';
import { LoginComponent } from './login/login.component';
import { NumbersComponent } from './numbers/numbers.component';
import { CaptureComponent } from './capture/capture.component';
import { MapComponent } from './map/map.component';
import { FriendsComponent } from './friends/friends.component';
import { ProfileComponent } from './profile/profile.component';
import { authGuard } from './guards/auth.guard';
import { JoinGroupComponent } from './join-group/join-group.component';

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: 'numbers', component: NumbersComponent, canActivate: [authGuard] },
  { path: 'capture', component: CaptureComponent, canActivate: [authGuard] },
  { path: 'map', component: MapComponent, canActivate: [authGuard] },
  { path: 'friends', component: FriendsComponent, canActivate: [authGuard] },
  { path: 'profile', component: ProfileComponent, canActivate: [authGuard] },
  { path: 'join/:token', component: JoinGroupComponent, canActivate: [authGuard] },
  { path: '', pathMatch: 'full', redirectTo: 'numbers' },
  { path: '**', redirectTo: 'numbers' },
];
